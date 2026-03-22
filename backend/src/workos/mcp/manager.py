from __future__ import annotations

import asyncio
import json
import logging

from langchain_core.tools import BaseTool
from langchain_mcp_adapters.client import MultiServerMCPClient

from workos.db.database import get_db

logger = logging.getLogger(__name__)


class MCPServerManager:
    """Manages MCP server connections and tool discovery.

    Uses an asyncio.Lock to prevent concurrent initialization races that
    would spawn duplicate child processes and exhaust system resources.

    Initializes each server independently so one failure doesn't prevent
    the rest from loading.
    """

    def __init__(self):
        self._client: MultiServerMCPClient | None = None
        self._tools: list[BaseTool] = []
        self._initialized = False
        self._lock = asyncio.Lock()
        self._init_errors: dict[str, str] = {}

    async def _load_server_configs(self) -> dict:
        """Load enabled MCP server configs from the database."""
        db = await get_db()
        cursor = await db.execute(
            "SELECT id, name, transport, config FROM mcp_servers WHERE enabled = 1"
        )
        rows = await cursor.fetchall()

        configs = {}
        for row in rows:
            name = row[1]
            transport = row[2]
            config = json.loads(row[3])

            if transport == "stdio":
                command = config.get("command", "")
                args = config.get("args", [])
                if command == "uvx":
                    import shutil
                    if not shutil.which("uvx") and shutil.which("uv"):
                        command = "uv"
                        args = ["tool", "run"] + args
                configs[name] = {
                    "transport": "stdio",
                    "command": command,
                    "args": args,
                }
                if config.get("env"):
                    configs[name]["env"] = config["env"]
            elif transport == "sse":
                configs[name] = {
                    "transport": "sse",
                    "url": config.get("url", ""),
                }
                if config.get("headers"):
                    configs[name]["headers"] = config["headers"]
            elif transport == "http":
                configs[name] = {
                    "transport": "streamable_http",
                    "url": config.get("url", ""),
                }
                if config.get("headers"):
                    configs[name]["headers"] = config["headers"]

        return configs

    async def _init_single_server(
        self, name: str, config: dict
    ) -> list[BaseTool]:
        """Initialize a single MCP server and return its tools.

        Returns empty list on failure so other servers can still load.
        """
        try:
            client = MultiServerMCPClient({name: config})
            tools = await asyncio.wait_for(
                client.get_tools(), timeout=30
            )
            logger.info("MCP server '%s' loaded %d tools", name, len(tools))
            return tools
        except asyncio.TimeoutError:
            err = f"Timeout connecting to MCP server '{name}'"
            logger.error(err)
            self._init_errors[name] = err
            return []
        except Exception as exc:
            err = f"Failed to connect to MCP server '{name}': {exc}"
            logger.error(err)
            self._init_errors[name] = err
            return []

    async def initialize(self) -> str | None:
        """Initialize or reinitialize MCP client with current server configs.

        Protected by an asyncio.Lock so concurrent callers wait rather than
        spawning duplicate child processes.

        Each server is initialized independently so one failure doesn't
        prevent the rest from loading.

        Returns an error message string if initialization failed, or None on success.
        """
        async with self._lock:
            await self._shutdown_locked()

            configs = await self._load_server_configs()
            if not configs:
                self._tools = []
                self._initialized = True
                logger.info("MCP initialized with 0 tools (no servers configured)")
                return None

            self._init_errors = {}
            all_tools: list[BaseTool] = []

            # Initialize each server independently with its own timeout
            tasks = [
                self._init_single_server(name, config)
                for name, config in configs.items()
            ]
            results = await asyncio.gather(*tasks)
            for tools in results:
                all_tools.extend(tools)

            self._tools = all_tools
            self._initialized = True

            failed = list(self._init_errors.keys())
            ok_count = len(configs) - len(failed)
            logger.info(
                "MCP initialized with %d tools from %d/%d servers%s",
                len(all_tools),
                ok_count,
                len(configs),
                f" (failed: {', '.join(failed)})" if failed else "",
            )
            return "; ".join(self._init_errors.values()) if failed else None

    async def get_tools(self) -> list[BaseTool]:
        """Get all available tools from connected MCP servers plus built-in tools.

        If not yet initialized, acquires the lock and initializes once.
        Concurrent callers wait on the lock instead of spawning duplicates.
        """
        if not self._initialized:
            await self.initialize()

        from workos.tools.web_search import builtin_tools
        return self._tools + builtin_tools

    async def refresh(self) -> str | None:
        """Refresh tools by reinitializing connections.

        Returns an error message string if refresh failed, or None on success.
        """
        return await self.initialize()

    async def test_server(self, server_name: str) -> dict:
        """Test connectivity to a specific MCP server.

        Spawns a temporary session, discovers tools, and returns results.
        Does NOT affect the main tool cache.
        """
        configs = await self._load_server_configs()
        if server_name not in configs:
            return {"status": "error", "error": f"Server '{server_name}' not found in active configs"}

        config = configs[server_name]
        try:
            client = MultiServerMCPClient({server_name: config})
            tools = await asyncio.wait_for(client.get_tools(), timeout=30)
            return {
                "status": "ok",
                "server_name": server_name,
                "tools_count": len(tools),
                "tools": [{"name": t.name, "description": t.description or ""} for t in tools],
            }
        except asyncio.TimeoutError:
            return {"status": "error", "error": f"Connection timed out after 30s"}
        except Exception as exc:
            return {"status": "error", "error": str(exc)[:200]}

    def get_server_tools(self, server_name: str) -> list[BaseTool]:
        """Get cached tools for a specific server by matching tool name prefix."""
        prefix = server_name + "_"
        return [t for t in self._tools if t.name.startswith(prefix)]

    async def _shutdown_locked(self):
        """Internal shutdown without acquiring the lock (caller must hold it)."""
        if self._client is not None:
            logger.info("Shutting down MCP client")
        self._client = None
        self._tools = []
        self._initialized = False

    async def shutdown(self):
        """Close all MCP server connections."""
        async with self._lock:
            await self._shutdown_locked()


mcp_manager = MCPServerManager()

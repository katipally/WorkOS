from __future__ import annotations

from pydantic import BaseModel, Field


class ThreadCreate(BaseModel):
    title: str = "New Chat"


class ThreadUpdate(BaseModel):
    title: str


class ThreadOut(BaseModel):
    id: str
    title: str
    created_at: str
    updated_at: str


class MessagePartText(BaseModel):
    type: str = "text"
    content: str


class MessagePartReasoning(BaseModel):
    type: str = "reasoning"
    content: str


class MessagePartToolCall(BaseModel):
    type: str = "tool_call"
    id: str
    name: str
    args: dict = Field(default_factory=dict)
    status: str = "pending"
    result: str | None = None


class MessagePartError(BaseModel):
    type: str = "error"
    message: str
    recoverable: bool = True


class MessagePartInterrupt(BaseModel):
    type: str = "interrupt"
    tool_call_id: str
    tool_name: str
    args: dict = Field(default_factory=dict)
    thread_id: str


class MessagePartTodo(BaseModel):
    type: str = "todo"
    todos: list[dict] = Field(default_factory=list)


class MessagePartStep(BaseModel):
    type: str = "step"
    step: int
    node: str


class MessageOut(BaseModel):
    id: str
    thread_id: str
    role: str
    parts: list[dict]
    created_at: str


class ChatRequest(BaseModel):
    thread_id: str | None = None
    message: str
    model: str | None = None


class CancelRequest(BaseModel):
    thread_id: str


class ApproveRequest(BaseModel):
    thread_id: str
    tool_call_id: str
    decision: str = "approve"


class MCPServerCreate(BaseModel):
    name: str
    transport: str
    config: dict = Field(default_factory=dict)
    enabled: bool = True


class MCPServerUpdate(BaseModel):
    name: str | None = None
    transport: str | None = None
    config: dict | None = None
    enabled: bool | None = None


class MCPServerOut(BaseModel):
    id: str
    name: str
    transport: str
    config: dict
    enabled: bool
    created_at: str
    tool_approvals: dict[str, bool] = Field(default_factory=dict)


class ToolApprovalUpdate(BaseModel):
    requires_approval: bool


class SettingsOut(BaseModel):
    max_steps: int = 25
    ollama_model: str = ""
    ollama_url: str = "http://localhost:11434"
    system_prompt: str = ""
    theme: str = "system"


class SettingsUpdate(BaseModel):
    max_steps: int | None = None
    ollama_model: str | None = None
    ollama_url: str | None = None
    system_prompt: str | None = None
    theme: str | None = None

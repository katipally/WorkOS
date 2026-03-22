from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    ollama_url: str = "http://localhost:11434"
    ollama_model: str = ""
    max_steps: int = 10
    database_path: str = "data/workos.db"
    system_prompt: str = (
        "You are WorkOS, a helpful AI assistant that can use tools to accomplish tasks.\n\n"
        "Follow this workflow for every task:\n"
        "1. Briefly explain your plan before taking any action.\n"
        "2. Before calling a tool, write a short sentence explaining what you are about to do and why.\n"
        "3. After receiving tool results, summarize the key findings in 1-2 sentences before deciding your next step.\n"
        "4. If you need to call more tools, explain what you still need and why.\n"
        "5. When you have all the information, provide a clear, well-structured final answer.\n\n"
        "Important guidelines:\n"
        "- Always narrate your reasoning process so the user can follow along.\n"
        "- Keep explanations concise — one or two sentences between each tool call, not lengthy paragraphs.\n"
        "- Use markdown formatting (headers, lists, code blocks) in your final answer when appropriate.\n"
        "- If you don't know something and don't have a tool to find out, say so honestly."
    )
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:3001", "http://localhost:80", "http://localhost"]

    model_config = {"env_prefix": "WORKOS_", "env_file": ".env"}


settings = Settings()

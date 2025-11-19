
# KINETIC | The Momentum Engine

> **Stop planning. Start executing.**

Kinetic is an AI-driven high-velocity productivity environment designed to eliminate the friction of the "cold start." It doesn't just list tasks; it proactively drafts them, intervenes when you drift, and uses procedural audio to induce flow states.

![Kinetic App Interface](https://placehold.co/1200x600/020617/3b82f6?text=KINETIC+INTERFACE)

## ⚡ Core Protocols

Kinetic differs from standard project management tools by assuming an active role in the work process:

### 1. DNA Extraction
Instead of a static form, Kinetic initiates a **Deep Dive Interrogation**. It asks clarifying questions to synthesize your project's `Audience`, `Stakes`, `Tone`, and `Anti-Goals`. This "DNA" is injected into every subsequent AI operation to prevent generic output.

### 2. The Trajectory (Linear Workflow)
No kanban boards. No scattered notes. Kinetic visualizes your project as a **Flight Path**. You move linearly from strategy to execution.
*   **Auto-Launch**: Completing onboarding immediately propels you into the first Sprint.
*   **The Tunnel**: A distraction-free editor where the UI fades away, leaving only the work and the Velocity Wave.

### 3. Active Intelligence
The system is not passive. It watches you work.
*   **Proactive Nudges**: If you stop typing or write generic fluff, "The Skeptic" or "The VC" persona will interrupt you with specific critiques.
*   **Agent Specialists**: Tasks are assigned to specific agents (e.g., `RESEARCHER` uses Google Search, `STRATEGIST` uses Mermaid.js for diagrams).

### 4. The Sonic Cortex
A built-in **Web Audio API engine** generates procedural Brown Noise with low-pass filtering specifically tuned for deep work.
*   **Auto-Engage**: Fades in automatically when you enter a task.
*   **Fades Out**: Disengages when you return to the dashboard.

### 5. Visual Velocity
The bottom of the screen features a reactive **Velocity Chart** that tracks your flow state in real-time. High-combo typing streaks trigger "Flow Mode," causing the UI to glow and pulse.

---

## 🛠 Tech Stack

*   **Core**: React 19, TypeScript, Vite
*   **AI**: Google Gemini API (`gemini-3-pro-preview` for heavy lifting, `gemini-2.5-flash` for real-time interactions)
*   **Styling**: Tailwind CSS (Obsidian/Neon palette)
*   **Visualization**: Recharts (Velocity), Mermaid.js (Diagrams)
*   **Audio**: Native Web Audio API (Procedural generation)

---

## 🚀 Getting Started

1.  **Clone the repository**
2.  **Install dependencies**
    ```bash
    npm install
    ```
3.  **Set API Key**
    Create a `.env` file and add your Google Gemini API key:
    ```env
    API_KEY=your_google_api_key_here
    ```
4.  **Initiate Sequence**
    ```bash
    npm start
    ```

## 🧠 Usage Guide

1.  **The Interview**: Answer the AI's questions. Be specific. The quality of the DNA determines the quality of the draft.
2.  **The Mission Brief**: Review the synthesized plan. You can upload raw context (notes, pasted decks) here.
3.  **Work Mode**:
    *   **Tab**: Edit Mode.
    *   **Eye Icon**: Preview Markdown.
    *   **Network Icon**: View generated Visuals/Diagrams.
    *   **Chat**: Talk to the active Agent. If they write code, click **"Apply to Canvas"** to inject it instantly.

---

*Built for the 10x Mind.*

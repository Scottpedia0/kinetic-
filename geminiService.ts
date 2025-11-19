import { GoogleGenAI, Type, Modality } from "@google/genai";
import { MicroTask, TaskStatus, AgentType, ChatMessage, VerificationStatus, BenchmarkData, AgentPersonality, ProjectDNA } from './types';

// Singleton instance to prevent recreating client repeatedly
let aiClient: GoogleGenAI | null = null;

const getAi = () => {
  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
  }
  return aiClient;
};

// Robust JSON cleaner that handles markdown blocks, trailing commas, and mixed text
const cleanJson = (text: string) => {
  if (!text) return "{}";
  let cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
  // Find the first '{' and last '}' to ignore preamble text
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  const firstBracket = cleaned.indexOf('[');
  const lastBracket = cleaned.lastIndexOf(']');

  if (firstBrace !== -1 && lastBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
      cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  } else if (firstBracket !== -1 && lastBracket !== -1) {
      cleaned = cleaned.substring(firstBracket, lastBracket + 1);
  }
  
  return cleaned;
};

const cleanMermaid = (text: string) => {
  return text.replace(/^```mermaid\s*/, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
};

// --- Prompts ---

const SYSTEM_INSTRUCTION_PLANNER = `
You are Kinetic, a Senior Product Architect.
You do not make generic lists. You build tactical, deliverable-based execution paths.

INPUT: Project DNA (Audience, Problem, Tone, Anti-Goals, Stakes).
OUTPUT: 4-7 distinct, high-impact Micro-Sprints.

CRITICAL RULES:
1. NO abstract titles (e.g. "Research"). Use DELIVERABLES (e.g. "Compile Competitor Pricing Matrix").
2. Tasks must be actionable immediately.
3. Assign the correct Expert Agent.
4. "Description" must specify exactly what success looks like.
5. Return ONLY valid JSON.
`;

const SYSTEM_INSTRUCTION_DRAFTER = `
You are the Project Lead. 
Your goal is to produce a "Gold Standard" draft based on the Project DNA.

CRITICAL INSTRUCTIONS:
1. ADOPT THE TONE: If user said "Steve Jobs", be concise and visionary. If "Academic", be rigorous.
2. AVOID ANTI-GOALS: Read the 'antiGoals' field. Do not do what they hate.
3. USE RAW CONTEXT: Integrate specific details from the user's dump.
4. FORMATTING: Use Markdown. Use headers, bullet points, and code blocks where necessary.

If Agent is RESEARCHER: Use Google Search.
If Agent is CODER: Write functional code.
`;

const SYSTEM_INSTRUCTION_INTERVENTION = `
You are an active collaborator watching the user work.
Your job is to INTERRUPT them if the work is drifting into mediocrity.

INPUT: Project DNA + Current User Draft.
TASK:
- If the draft is generic, boring, or violates the DNA: Return a specific, biting critique or suggestion.
- If the draft is good: Return "NULL".

Return JSON: { "shouldInterrupt": boolean, "message": string, "agentPersona": "SKEPTIC" | "VC" | "HYPE_MAN" }
`;

const PERSONAS: Record<AgentPersonality, string> = {
  DEFAULT: "You are a helpful, intelligent coworker. If asked to rewrite or provide code, ALWAYS wrap the actionable content in a markdown code block (```) so the user can apply it.",
  SKEPTIC: "You are 'The Skeptic'. You find holes. You hate buzzwords. If asked to fix something, provide the corrected version in a code block (```).",
  HYPE_MAN: "You are 'The Hype Man'. You see the viral potential. If asked to punch up copy, provide the new version in a code block (```).",
  VC: "You are 'The VC'. You care about business viability. If asked to adjust strategy, provide the specific text in a code block (```)."
};

const FALLBACK_QUESTIONS = [
  "Who specifically loses money or time if this problem isn't solved?",
  "What is the one 'Unfair Advantage' you have over competitors?",
  "Describe the 'Magic Moment' when a user realizes the value.",
  "What is the biggest risk that could kill this project?"
];

// --- Functions ---

export const generateFollowUp = async (history: {question: string, answer: string}[]): Promise<string> => {
  try {
    const context = history.map(h => `Q: ${h.question}\nA: ${h.answer}`).join('\n');
    const previousQuestions = history.map(h => h.question).join(' | ');

    const response = await getAi().models.generateContent({
      model: "gemini-2.5-flash",
      contents: `
        You are an expert consultant conducting a "Deep Dive" discovery session.
        
        TRANSCRIPT SO FAR:
        ${context}

        ALREADY ASKED:
        ${previousQuestions}

        TASK:
        Ask ONE provocative, clarifying follow-up question.
        - DO NOT repeat questions.
        - Pick up on a specific detail from the last Answer.
        - Dig into the "Why" or the "Mechanism".
        - Be brief. 1 sentence only.
      `,
    });
    
    const text = response.text?.trim();
    if (!text || previousQuestions.includes(text)) {
        throw new Error("Duplicate or empty response");
    }
    return text;
  } catch (e) {
    const index = history.length % FALLBACK_QUESTIONS.length;
    return FALLBACK_QUESTIONS[index];
  }
};

export const synthesizeDNA = async (history: {question: string, answer: string}[], rawContext: string): Promise<ProjectDNA> => {
  try {
    const context = history.map(h => `Q: ${h.question}\nA: ${h.answer}`).join('\n');
    const response = await getAi().models.generateContent({
      model: "gemini-3-pro-preview",
      contents: `
        TRANSCRIPT:
        ${context}
        
        RAW CONTEXT:
        ${rawContext}

        TASK:
        Synthesize this into a structured Project DNA object.
        Infer the Audience, Problem, Tone, etc. from the conversation.
        BE SPECIFIC. Do not use generic placeholders.
      `,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            audience: { type: Type.STRING },
            problem: { type: Type.STRING },
            tone: { type: Type.STRING },
            antiGoals: { type: Type.STRING },
            stakes: { type: Type.STRING },
          },
          required: ["audience", "problem", "tone", "antiGoals", "stakes"]
        }
      }
    });
    
    const parsed = JSON.parse(cleanJson(response.text || "{}"));
    return { ...parsed, rawContext };
  } catch (e) {
    console.error("DNA Synthesis failed", e);
    return {
      audience: "General Audience",
      problem: "Undefined Problem",
      tone: "Professional",
      antiGoals: "Generic content",
      stakes: "High",
      rawContext
    };
  }
};

export const generatePlan = async (dna: ProjectDNA): Promise<Omit<MicroTask, 'id' | 'status' | 'content' | 'chatHistory' | 'verificationStatus'>[]> => {
  try {
    const response = await getAi().models.generateContent({
      model: "gemini-3-pro-preview",
      contents: `
      PROJECT DNA:
      Audience: ${dna.audience}
      Problem: ${dna.problem}
      Tone: ${dna.tone}
      Anti-Goals (AVOID): ${dna.antiGoals}
      Stakes: ${dna.stakes}
      
      Raw Context: ${dna.rawContext.slice(0, 3000)}
      
      Create the execution plan.`,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION_PLANNER,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              description: { type: Type.STRING },
              estimatedMinutes: { type: Type.NUMBER },
              agentType: { type: Type.STRING, enum: ['RESEARCHER', 'CODER', 'WRITER', 'STRATEGIST'] }
            },
            required: ["title", "description", "estimatedMinutes", "agentType"]
          }
        }
      }
    });

    if (!response.text) throw new Error("No plan generated");
    return JSON.parse(cleanJson(response.text));
  } catch (error) {
    console.error("Planning failed:", error);
    throw error;
  }
};

export const draftTaskContent = async (task: MicroTask, dna: ProjectDNA, previousContext: string = ""): Promise<string> => {
  try {
    const prompt = `
     Current Sprint: ${task.title}
     Agent: ${task.agentType}
     Instructions: ${task.description}
     
     PROJECT DNA:
     Audience: ${dna.audience}
     Tone: ${dna.tone}
     Avoid: ${dna.antiGoals}
     
     Raw Data:
     ${dna.rawContext.slice(0, 5000)}

     Previous Context (Work done so far):
     ${previousContext.slice(-3000)} 
     
     EXECUTE THIS TASK. Provide the full output.
    `;

    const config: any = {
        systemInstruction: SYSTEM_INSTRUCTION_DRAFTER,
    };

    if (task.agentType === 'RESEARCHER') {
        config.tools = [{ googleSearch: {} }];
    }

    const response = await getAi().models.generateContent({
      model: "gemini-3-pro-preview",
      contents: prompt,
      config: config
    });

    let text = response.text || "";
    
    if (!text) return "// No content generated. Please try again.";

    // Append sources if researcher
    if (task.agentType === 'RESEARCHER' && response.candidates?.[0]?.groundingMetadata?.groundingChunks) {
      const chunks = response.candidates[0].groundingMetadata.groundingChunks;
      const links = chunks
        .map((c: any) => c.web?.uri ? `[${c.web.title}](${c.web.uri})` : null)
        .filter(Boolean)
        .join('\n');
      if (links) text += `\n\n### Sources\n${links}`;
    }

    return text;
  } catch (error) {
    console.error("Drafting failed", error);
    return "Error generating draft. Please check your API key or connection.";
  }
};

export const generateIntervention = async (currentContent: string, dna: ProjectDNA): Promise<{ shouldInterrupt: boolean, message: string, agentPersona: AgentPersonality } | null> => {
  try {
    const response = await getAi().models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Project DNA Tone: ${dna.tone}\nAnti-Goals: ${dna.antiGoals}\n\nCurrent Draft Segment:\n${currentContent.slice(-1000)}`,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION_INTERVENTION,
        responseMimeType: "application/json",
        responseSchema: {
            type: Type.OBJECT,
            properties: {
                shouldInterrupt: { type: Type.BOOLEAN },
                message: { type: Type.STRING },
                agentPersona: { type: Type.STRING, enum: ['SKEPTIC', 'VC', 'HYPE_MAN'] }
            }
        }
      }
    });

    if (!response.text) return null;
    const result = JSON.parse(cleanJson(response.text));
    if (!result.shouldInterrupt) return null;
    
    return {
        shouldInterrupt: true,
        message: result.message,
        agentPersona: result.agentPersona
    };
  } catch (e) {
    return null;
  }
}

export const generateVisual = async (content: string): Promise<string> => {
  try {
    const response = await getAi().models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Convert this text into a visual chart structure:\n\n${content.slice(0, 5000)}`,
      config: { systemInstruction: "Return ONLY mermaid.js syntax. Do not use markdown blocks. Start with 'graph TD' or 'sequenceDiagram' etc." }
    });
    return cleanMermaid(response.text || "");
  } catch (e) {
    return "graph TD\nA[Error] --> B[Could not visualize]";
  }
}

export const chatWithAgent = async (
    message: string, 
    task: MicroTask, 
    currentContent: string, 
    dna: ProjectDNA,
    personality: AgentPersonality = 'DEFAULT'
): Promise<string> => {
    try {
        const prompt = `
        Task: ${task.title} (${task.agentType})
        DNA: ${JSON.stringify(dna)}
        Draft: ${currentContent.slice(0, 3000)}
        User: "${message}"

        If you are providing a rewrite, code snippet, or specific text edit, you MUST wrap it in a markdown code block (e.g. \`\`\`text ... \`\`\`) so the user can apply it.
        `;

        const config: any = {
            systemInstruction: PERSONAS[personality],
        };
        
        if (task.agentType === 'RESEARCHER') config.tools = [{ googleSearch: {} }];

        const response = await getAi().models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: config
        });

        return response.text || "I'm listening...";

    } catch (error) {
        return "Connection unstable.";
    }
}

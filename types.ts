export enum AppState {
  IDLE = 'IDLE',
  DNA_EXTRACTION = 'DNA_EXTRACTION',
  DASHBOARD = 'DASHBOARD',
  WORKING = 'WORKING',
  SUMMARY = 'SUMMARY'
}

export enum TaskStatus {
  PENDING = 'PENDING',
  DRAFTING = 'DRAFTING', 
  READY = 'READY',       
  IN_PROGRESS = 'IN_PROGRESS', 
  COMPLETED = 'COMPLETED'
}

export enum VerificationStatus {
  PENDING = 'PENDING',
  REVIEWING = 'REVIEWING',
  NEEDS_REVISION = 'NEEDS_REVISION',
  APPROVED = 'APPROVED'
}

export type AgentType = 'RESEARCHER' | 'CODER' | 'WRITER' | 'STRATEGIST';
export type AgentPersonality = 'SKEPTIC' | 'HYPE_MAN' | 'VC' | 'DEFAULT';

export interface ProjectDNA {
  audience: string;
  problem: string;
  tone: string;
  antiGoals: string; // What we strictly avoid
  stakes: string;    // Why does this matter?
  rawContext: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'ai';
  text: string;
  timestamp: number;
  senderName?: string;
  personality?: AgentPersonality;
}

export interface MicroTask {
  id: string;
  title: string;
  description: string;
  estimatedMinutes: number;
  status: TaskStatus;
  verificationStatus: VerificationStatus;
  agentType: AgentType;
  content?: string; 
  visualCode?: string;
  chatHistory: ChatMessage[]; 
}

export interface BenchmarkData {
  competitorName: string;
  strength: string;
  weakness: string;
  opportunityForUs: string;
}

export interface VelocityPoint {
  time: string;
  score: number;
}
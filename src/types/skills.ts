export type SkillSource = "custom" | "imported" | "premade";
export type SkillSafetyLevel = "low" | "medium" | "high";

export interface AppSkill {
  author?: string;
  category: string;
  createdAt: string;
  description: string;
  enabled: boolean;
  id: string;
  installed: boolean;
  instructions: string;
  name: string;
  path?: string;
  safetyLevel: SkillSafetyLevel;
  source: SkillSource;
  tags: string[];
  trigger: string;
  updatedAt: string;
  version: number;
}

export interface SkillRegistryState {
  skills: AppSkill[];
  updatedAt: string;
  version: 1;
}

export interface SkillPreset {
  author: string;
  category: string;
  defaultInstalled: boolean;
  description: string;
  id: string;
  instructions: string;
  name: string;
  safetyLevel: SkillSafetyLevel;
  tags: string[];
  trigger: string;
}

export interface SkillDraft {
  category?: string;
  description: string;
  enabled?: boolean;
  id?: string;
  instructions: string;
  name: string;
  path?: string;
  safetyLevel?: SkillSafetyLevel;
  source?: SkillSource;
  tags?: string[];
  trigger?: string;
}

export interface SkillPromptMatch {
  reason: "explicit" | "semantic";
  score: number;
  skill: AppSkill;
}

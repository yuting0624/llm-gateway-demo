export interface User {
  user_id: string;
  spend: number;
  max_budget?: number;
  models?: string[];
}

export interface Team {
  team_id: string;
  team_alias?: string;
  spend: number;
  max_budget?: number;
  models?: string[];
}

export interface ApiKey {
  token: string;
  key_name?: string;
  user_id?: string;
  team_id?: string;
  spend: number;
  max_budget?: number;
  models?: string[];
  created_at?: string;
}

export interface Model {
  id: string;
  created?: number;
  object?: string;
  owned_by?: string;
}

export interface SpendData {
  daily_spend?: Record<string, number>;
  model_spend?: Record<string, number>;
  user_spend?: Record<string, number>;
  total_spend?: number;
}

export interface SpendLog {
  request_id?: string;
  api_key?: string;
  model?: string;
  user?: string;
  team?: string;
  spend?: number;
  startTime?: string;
  endTime?: string;
}

export interface GlobalSpendReport {
  total_spend: number;
  total_requests: number;
}

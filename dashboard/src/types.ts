export interface User {
  user_id: string;
  user_email?: string;
  user_alias?: string;
  spend: number;
  max_budget?: number;
  models?: string[];
  user_role?: string;
  teams?: string[];
}

export interface Team {
  team_id: string;
  team_alias?: string;
  spend?: number;
  max_budget?: number;
  models?: string[];
  members_with_roles?: { user_id: string; role: string }[];
}

export interface ApiKey {
  token: string;
  key_name?: string;
  key_alias?: string;
  user_id?: string;
  team_id?: string;
  spend: number;
  max_budget?: number;
  models?: string[];
  created_at?: string;
  expires?: string;
  last_active?: string;
}

export interface Model {
  id: string;
  created?: number;
  object?: string;
  owned_by?: string;
}

export interface ModelSpend {
  model: string;
  total_spend: number;
}

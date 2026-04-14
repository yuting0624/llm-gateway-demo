import { User, Team, ApiKey, Model, ModelSpend } from './types';

const API_BASE = 'https://litellm-proxy-258509337164.asia-northeast1.run.app';

export class ApiClient {
  private masterKey: string;

  constructor(masterKey: string) {
    this.masterKey = masterKey;
  }

  private async fetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.masterKey}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API Error: ${response.status} - ${error}`);
    }

    return response.json();
  }

  async checkHealth(): Promise<boolean> {
    try {
      await this.fetch('/health/liveliness');
      return true;
    } catch {
      return false;
    }
  }

  async getModels(): Promise<Model[]> {
    const data = await this.fetch<{ data: Model[] }>('/v1/models');
    return data.data || [];
  }

  async getUsers(): Promise<User[]> {
    try {
      const data = await this.fetch<any>('/user/list');
      // Response is { users: [...] }
      if (data && data.users && Array.isArray(data.users)) return data.users;
      if (Array.isArray(data)) return data;
      return [];
    } catch {
      return [];
    }
  }

  async getTeams(): Promise<Team[]> {
    try {
      const data = await this.fetch<any>('/team/list');
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  async getKeys(): Promise<ApiKey[]> {
    try {
      const data = await this.fetch<any>('/key/list?include_team_keys=true&return_full_object=true&page_size=100');
      if (data && data.keys && Array.isArray(data.keys)) return data.keys;
      if (Array.isArray(data)) return data;
      return [];
    } catch {
      return [];
    }
  }

  async getDailySpend(): Promise<{ date: string; spend: number }[]> {
    try {
      const data = await this.fetch<any[]>('/global/spend/logs');
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  async getModelSpend(): Promise<ModelSpend[]> {
    try {
      const data = await this.fetch<ModelSpend[]>('/global/spend/models?limit=20');
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  async getKeySpend(): Promise<{ api_key: string; key_name: string; key_alias: string; total_spend: number }[]> {
    try {
      const data = await this.fetch<any[]>('/global/spend/keys?limit=20');
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  async createUser(userId: string, maxBudget?: number, models?: string[]): Promise<{ key: string }> {
    const data = await this.fetch<{ key: string }>('/key/generate', {
      method: 'POST',
      body: JSON.stringify({
        user_id: userId,
        max_budget: maxBudget,
        models: models,
      }),
    });
    return data;
  }

  async createTeam(teamAlias: string, maxBudget?: number, models?: string[]): Promise<Team> {
    const data = await this.fetch<Team>('/team/new', {
      method: 'POST',
      body: JSON.stringify({
        team_alias: teamAlias,
        max_budget: maxBudget,
        models: models,
      }),
    });
    return data;
  }

  async deleteKey(key: string): Promise<void> {
    await this.fetch<void>('/key/delete', {
      method: 'POST',
      body: JSON.stringify({ keys: [key] }),
    });
  }
}

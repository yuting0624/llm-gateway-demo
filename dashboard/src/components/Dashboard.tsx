import { useState, useEffect } from 'react';
import { Grid, Card, CardContent, Typography, Box, CircularProgress, Paper } from '@mui/material';
import { PieChart, Pie, Cell, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { ApiClient } from '../api';
import { SpendLog } from '../types';

interface DashboardProps {
  apiClient: ApiClient;
  refreshTrigger?: number;
}

const COLORS = ['#1a73e8', '#34a853', '#fbbc04', '#ea4335', '#9334e8', '#ff6d00', '#00acc1', '#7cb342'];

export default function Dashboard({ apiClient, refreshTrigger }: DashboardProps) {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalUsers: 0,
    totalKeys: 0,
    totalSpend: 0,
    totalRequests: 0,
  });
  const [modelCostData, setModelCostData] = useState<{ name: string; value: number }[]>([]);
  const [dailyRequestData, setDailyRequestData] = useState<{ date: string; [key: string]: any }[]>([]);
  const [userCostData, setUserCostData] = useState<{ name: string; cost: number }[]>([]);

  useEffect(() => {
    loadData();
  }, [refreshTrigger]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [report, logs, users, keys] = await Promise.all([
        apiClient.getGlobalSpendReport(),
        apiClient.getSpendLogs(),
        apiClient.getUsers(),
        apiClient.getKeys(),
      ]);

      setStats({
        totalUsers: users.length,
        totalKeys: keys.length,
        totalSpend: report.total_spend,
        totalRequests: report.total_requests,
      });

      processModelCostData(logs);
      processDailyRequestData(logs);
      processUserCostData(logs);
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const processModelCostData = (logs: SpendLog[]) => {
    const modelCosts: Record<string, number> = {};
    logs.forEach(log => {
      if (log.model && log.spend) {
        modelCosts[log.model] = (modelCosts[log.model] || 0) + log.spend;
      }
    });

    const data = Object.entries(modelCosts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    setModelCostData(data);
  };

  const processDailyRequestData = (logs: SpendLog[]) => {
    const dailyData: Record<string, Record<string, number>> = {};

    logs.forEach(log => {
      if (log.startTime && log.model) {
        const date = new Date(log.startTime).toISOString().split('T')[0];
        if (!dailyData[date]) {
          dailyData[date] = {};
        }
        dailyData[date][log.model] = (dailyData[date][log.model] || 0) + 1;
      }
    });

    const data = Object.entries(dailyData)
      .map(([date, models]) => ({ date, ...models }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-14);

    setDailyRequestData(data);
  };

  const processUserCostData = (logs: SpendLog[]) => {
    const userCosts: Record<string, number> = {};
    logs.forEach(log => {
      if (log.user && log.spend) {
        userCosts[log.user] = (userCosts[log.user] || 0) + log.spend;
      }
    });

    const data = Object.entries(userCosts)
      .map(([name, cost]) => ({ name, cost }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 10);

    setUserCostData(data);
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <CircularProgress />
      </Box>
    );
  }

  const allModels = Array.from(new Set(dailyRequestData.flatMap(d => Object.keys(d).filter(k => k !== 'date'))));

  return (
    <Box>
      <Grid container spacing={3}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="text.secondary" gutterBottom>
                合計ユーザー数
              </Typography>
              <Typography variant="h4" sx={{ fontWeight: 600, color: 'primary.main' }}>
                {stats.totalUsers}
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="text.secondary" gutterBottom>
                合計APIキー数
              </Typography>
              <Typography variant="h4" sx={{ fontWeight: 600, color: 'primary.main' }}>
                {stats.totalKeys}
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="text.secondary" gutterBottom>
                合計コスト
              </Typography>
              <Typography variant="h4" sx={{ fontWeight: 600, color: 'primary.main' }}>
                ${stats.totalSpend.toFixed(4)}
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="text.secondary" gutterBottom>
                合計リクエスト数
              </Typography>
              <Typography variant="h4" sx={{ fontWeight: 600, color: 'primary.main' }}>
                {stats.totalRequests.toLocaleString()}
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              モデル別コスト
            </Typography>
            {modelCostData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={modelCostData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {modelCostData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => `$${value.toFixed(4)}`} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <Box sx={{ textAlign: 'center', py: 5, color: 'text.secondary' }}>
                データがありません
              </Box>
            )}
          </Paper>
        </Grid>

        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              ユーザー別コスト Top 10
            </Typography>
            {userCostData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={userCostData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="name" width={100} />
                  <Tooltip formatter={(value: number) => `$${value.toFixed(4)}`} />
                  <Bar dataKey="cost" fill="#1a73e8" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Box sx={{ textAlign: 'center', py: 5, color: 'text.secondary' }}>
                データがありません
              </Box>
            )}
          </Paper>
        </Grid>

        <Grid item xs={12}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>
              日別リクエスト数 (過去14日間)
            </Typography>
            {dailyRequestData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={dailyRequestData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  {allModels.map((model, index) => (
                    <Line
                      key={model}
                      type="monotone"
                      dataKey={model}
                      stroke={COLORS[index % COLORS.length]}
                      strokeWidth={2}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <Box sx={{ textAlign: 'center', py: 5, color: 'text.secondary' }}>
                データがありません
              </Box>
            )}
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}

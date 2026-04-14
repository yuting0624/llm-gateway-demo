import { useState, useEffect } from 'react';
import { Grid, Card, CardContent, Typography, Box, CircularProgress, Paper } from '@mui/material';
import { PieChart, Pie, Cell, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { People, VpnKey, AttachMoney, QueryStats } from '@mui/icons-material';
import { ApiClient } from '../api';

interface DashboardProps {
  apiClient: ApiClient;
  refreshTrigger?: number;
}

const COLORS = ['#1a73e8', '#34a853', '#fbbc04', '#ea4335', '#9334e8', '#ff6d00', '#00acc1', '#7cb342'];

function formatModelName(model: string): string {
  return model
    .replace('vertex_ai/', '')
    .replace('-preview', '')
    .replace('-lite', ' Lite');
}

export default function Dashboard({ apiClient, refreshTrigger }: DashboardProps) {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalUsers: 0,
    totalKeys: 0,
    totalSpend: 0,
    totalModels: 0,
  });
  const [modelCostData, setModelCostData] = useState<{ name: string; value: number }[]>([]);
  const [dailySpendData, setDailySpendData] = useState<{ date: string; spend: number }[]>([]);
  const [keyCostData, setKeyCostData] = useState<{ name: string; cost: number }[]>([]);

  useEffect(() => {
    loadData();
  }, [refreshTrigger]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [users, keys, models, modelSpend, dailySpend, keySpend] = await Promise.all([
        apiClient.getUsers(),
        apiClient.getKeys(),
        apiClient.getModels(),
        apiClient.getModelSpend(),
        apiClient.getDailySpend(),
        apiClient.getKeySpend(),
      ]);

      const totalSpend = modelSpend.reduce((sum, m) => sum + (m.total_spend || 0), 0);

      setStats({
        totalUsers: users.length,
        totalKeys: keys.length,
        totalSpend,
        totalModels: models.length,
      });

      // Model cost pie chart
      const mcData = modelSpend
        .filter(m => m.total_spend > 0)
        .map(m => ({ name: formatModelName(m.model), value: m.total_spend }))
        .sort((a, b) => b.value - a.value);
      setModelCostData(mcData);

      // Daily spend line chart
      const dsData = dailySpend
        .map(d => ({ date: d.date, spend: d.spend }))
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(-14);
      setDailySpendData(dsData);

      // Key cost bar chart (top 10)
      const kcData = keySpend
        .filter(k => k.total_spend > 0)
        .map(k => ({
          name: k.key_alias || k.key_name || k.api_key.slice(0, 12) + '...',
          cost: k.total_spend,
        }))
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 10);
      setKeyCostData(kcData);
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <CircularProgress />
      </Box>
    );
  }

  const statCards = [
    { label: '合計ユーザー数', value: stats.totalUsers, icon: <People />, color: '#1a73e8' },
    { label: '合計APIキー数', value: stats.totalKeys, icon: <VpnKey />, color: '#34a853' },
    { label: '合計コスト', value: `$${stats.totalSpend.toFixed(4)}`, icon: <AttachMoney />, color: '#ea4335' },
    { label: '利用可能モデル', value: stats.totalModels, icon: <QueryStats />, color: '#fbbc04' },
  ];

  return (
    <Box>
      <Grid container spacing={3}>
        {statCards.map((card) => (
          <Grid item xs={12} sm={6} md={3} key={card.label}>
            <Card sx={{ borderLeft: `4px solid ${card.color}` }}>
              <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Box sx={{ color: card.color, opacity: 0.8 }}>{card.icon}</Box>
                <Box>
                  <Typography color="text.secondary" variant="body2">
                    {card.label}
                  </Typography>
                  <Typography variant="h4" sx={{ fontWeight: 600, color: card.color }}>
                    {card.value}
                  </Typography>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        ))}

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
                  <Tooltip formatter={(value: number) => `$${value.toFixed(6)}`} />
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
              APIキー別コスト Top 10
            </Typography>
            {keyCostData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={keyCostData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" tickFormatter={(v) => `$${v.toFixed(4)}`} />
                  <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(value: number) => `$${value.toFixed(6)}`} />
                  <Bar dataKey="cost" fill="#1a73e8" radius={[0, 4, 4, 0]} />
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
              日別コスト推移
            </Typography>
            {dailySpendData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={dailySpendData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis tickFormatter={(v) => `$${v.toFixed(3)}`} />
                  <Tooltip formatter={(value: number) => `$${value.toFixed(6)}`} />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="spend"
                    name="コスト"
                    stroke="#1a73e8"
                    strokeWidth={2}
                    dot={{ r: 4 }}
                    activeDot={{ r: 6 }}
                  />
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

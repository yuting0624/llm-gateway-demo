import { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  CircularProgress,
  Grid,
  Chip,
  Avatar,
} from '@mui/material';
import { CheckCircle, SmartToy } from '@mui/icons-material';
import { ApiClient } from '../api';
import { Model } from '../types';

interface ModelListProps {
  apiClient: ApiClient;
}

export default function ModelList({ apiClient }: ModelListProps) {
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [healthStatus, setHealthStatus] = useState<boolean>(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [modelsData, health] = await Promise.all([
        apiClient.getModels(),
        apiClient.checkHealth(),
      ]);
      setModels(modelsData);
      setHealthStatus(health);
    } catch (error) {
      console.error('Failed to load models:', error);
    } finally {
      setLoading(false);
    }
  };

  const getModelProvider = (modelId: string): { name: string; color: string } => {
    if (modelId.includes('claude')) {
      return { name: 'Claude (Anthropic)', color: '#D97757' };
    } else if (modelId.includes('gemini')) {
      return { name: 'Gemini (Google)', color: '#4285f4' };
    }
    return { name: 'Unknown', color: '#757575' };
  };

  const getModelLocation = (modelId: string): string => {
    if (modelId.includes('us')) return 'US';
    if (modelId.includes('europe')) return 'Europe';
    if (modelId.includes('asia')) return 'Asia';
    return 'Global';
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h5">モデル一覧</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <CheckCircle sx={{ color: healthStatus ? 'success.main' : 'error.main' }} />
          <Typography variant="body2" color={healthStatus ? 'success.main' : 'error.main'}>
            {healthStatus ? 'システム正常' : 'システムエラー'}
          </Typography>
        </Box>
      </Box>

      <Grid container spacing={3}>
        {models.length === 0 ? (
          <Grid item xs={12}>
            <Card>
              <CardContent sx={{ textAlign: 'center', py: 6 }}>
                <Typography color="text.secondary">
                  モデルがありません
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ) : (
          models.map((model) => {
            const provider = getModelProvider(model.id);
            const location = getModelLocation(model.id);

            return (
              <Grid item xs={12} sm={6} md={4} key={model.id}>
                <Card sx={{ height: '100%', transition: 'transform 0.2s', '&:hover': { transform: 'translateY(-4px)' } }}>
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                      <Avatar sx={{ bgcolor: provider.color, mr: 2 }}>
                        <SmartToy />
                      </Avatar>
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="h6" sx={{ fontSize: '1rem', fontWeight: 600 }}>
                          {model.id}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {provider.name}
                        </Typography>
                      </Box>
                    </Box>

                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
                      <Chip label={location} size="small" color="primary" variant="outlined" />
                      <Chip label="Vertex AI" size="small" variant="outlined" />
                    </Box>

                    <Box sx={{ pt: 1, borderTop: 1, borderColor: 'divider' }}>
                      <Typography variant="caption" color="text.secondary" display="block">
                        Created: {model.created ? new Date(model.created * 1000).toLocaleDateString('ja-JP') : 'N/A'}
                      </Typography>
                      {model.owned_by && (
                        <Typography variant="caption" color="text.secondary" display="block">
                          Owned by: {model.owned_by}
                        </Typography>
                      )}
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            );
          })
        )}
      </Grid>
    </Box>
  );
}

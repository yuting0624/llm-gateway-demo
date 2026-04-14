import { useState } from 'react';
import { Box, Card, CardContent, TextField, Button, Typography, Container } from '@mui/material';
import { Cloud } from '@mui/icons-material';

interface LoginScreenProps {
  onLogin: (key: string) => Promise<void>;
}

export default function LoginScreen({ onLogin }: LoginScreenProps) {
  const [key, setKey] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await onLogin(key);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #1a73e8 0%, #4285f4 100%)',
      }}
    >
      <Container maxWidth="sm">
        <Card elevation={4}>
          <CardContent sx={{ p: 4 }}>
            <Box sx={{ textAlign: 'center', mb: 4 }}>
              <Cloud sx={{ fontSize: 60, color: 'primary.main', mb: 2 }} />
              <Typography variant="h4" gutterBottom sx={{ fontWeight: 600, color: 'text.primary' }}>
                LLM Gateway 管理コンソール
              </Typography>
              <Typography variant="body1" color="text.secondary">
                Google Cloud × Vertex AI
              </Typography>
            </Box>

            <form onSubmit={handleSubmit}>
              <TextField
                fullWidth
                type="password"
                label="マスターキー"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                margin="normal"
                required
                autoFocus
              />
              <Button
                type="submit"
                fullWidth
                variant="contained"
                size="large"
                disabled={loading || !key}
                sx={{ mt: 3 }}
              >
                {loading ? 'ログイン中...' : 'ログイン'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </Container>
    </Box>
  );
}

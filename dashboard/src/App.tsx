import { useState, useEffect } from 'react';
import { Box, AppBar, Toolbar, Typography, Button, Tabs, Tab, Container, Snackbar, Alert } from '@mui/material';
import { Logout } from '@mui/icons-material';
import LoginScreen from './components/LoginScreen';
import Dashboard from './components/Dashboard';
import UserManagement from './components/UserManagement';
import TeamManagement from './components/TeamManagement';
import KeyManagement from './components/KeyManagement';
import ModelList from './components/ModelList';
import { ApiClient } from './api';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentTab, setCurrentTab] = useState(0);
  const [apiClient, setApiClient] = useState<ApiClient | null>(null);
  const [error, setError] = useState<string>('');
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  useEffect(() => {
    const savedKey = sessionStorage.getItem('masterKey');
    if (savedKey) {
      setApiClient(new ApiClient(savedKey));
      setIsAuthenticated(true);
    }
  }, []);

  const handleLogin = async (key: string) => {
    const client = new ApiClient(key);
    const isValid = await client.checkHealth();

    if (isValid) {
      setApiClient(client);
      setIsAuthenticated(true);
      sessionStorage.setItem('masterKey', key);
    } else {
      setError('認証に失敗しました。マスターキーを確認してください。');
    }
  };

  const handleLogout = () => {
    setApiClient(null);
    setIsAuthenticated(false);
    sessionStorage.removeItem('masterKey');
    setCurrentTab(0);
  };

  const handleRefresh = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  if (!isAuthenticated) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="static" elevation={1}>
        <Toolbar>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1, fontWeight: 600 }}>
            LLM Gateway 管理コンソール
          </Typography>
          <Button color="inherit" startIcon={<Logout />} onClick={handleLogout}>
            ログアウト
          </Button>
        </Toolbar>
      </AppBar>

      <Box sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
        <Container maxWidth="xl">
          <Tabs value={currentTab} onChange={(_, newValue) => setCurrentTab(newValue)}>
            <Tab label="ダッシュボード" />
            <Tab label="ユーザー管理" />
            <Tab label="チーム管理" />
            <Tab label="APIキー管理" />
            <Tab label="モデル一覧" />
          </Tabs>
        </Container>
      </Box>

      <Container maxWidth="xl" sx={{ mt: 4, mb: 4, flex: 1 }}>
        {currentTab === 0 && apiClient && <Dashboard apiClient={apiClient} refreshTrigger={refreshTrigger} />}
        {currentTab === 1 && apiClient && <UserManagement apiClient={apiClient} onRefresh={handleRefresh} />}
        {currentTab === 2 && apiClient && <TeamManagement apiClient={apiClient} onRefresh={handleRefresh} />}
        {currentTab === 3 && apiClient && <KeyManagement apiClient={apiClient} onRefresh={handleRefresh} />}
        {currentTab === 4 && apiClient && <ModelList apiClient={apiClient} />}
      </Container>

      <Snackbar open={!!error} autoHideDuration={6000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')}>
          {error}
        </Alert>
      </Snackbar>
    </Box>
  );
}

export default App;

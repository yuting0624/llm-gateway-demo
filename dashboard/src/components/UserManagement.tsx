import { useState, useEffect } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  CircularProgress,
  Chip,
  Paper,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  OutlinedInput,
  Snackbar,
  Alert,
  IconButton,
} from '@mui/material';
import { Add, ContentCopy } from '@mui/icons-material';
import { ApiClient } from '../api';
import { User, Model } from '../types';

interface UserManagementProps {
  apiClient: ApiClient;
  onRefresh?: () => void;
}

export default function UserManagement({ apiClient, onRefresh }: UserManagementProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [keyDialogOpen, setKeyDialogOpen] = useState(false);
  const [generatedKey, setGeneratedKey] = useState('');
  const [newUser, setNewUser] = useState({
    userId: '',
    maxBudget: '',
    models: [] as string[],
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [usersData, modelsData] = await Promise.all([
        apiClient.getUsers(),
        apiClient.getModels(),
      ]);
      setUsers(usersData);
      setModels(modelsData);
    } catch (error) {
      setError('データの読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = async () => {
    if (!newUser.userId) {
      setError('ユーザーIDを入力してください');
      return;
    }

    setCreating(true);
    try {
      const result = await apiClient.createUser(
        newUser.userId,
        newUser.maxBudget ? parseFloat(newUser.maxBudget) : undefined,
        newUser.models.length > 0 ? newUser.models : undefined
      );

      setGeneratedKey(result.key);
      setKeyDialogOpen(true);
      setDialogOpen(false);
      setNewUser({ userId: '', maxBudget: '', models: [] });
      setSuccess('ユーザーを作成しました');
      loadData();
      onRefresh?.();
    } catch (error) {
      setError('ユーザーの作成に失敗しました: ' + (error as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setSuccess('クリップボードにコピーしました');
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
        <Typography variant="h5">ユーザー管理</Typography>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => setDialogOpen(true)}
        >
          新規ユーザー作成
        </Button>
      </Box>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell><strong>ユーザーID</strong></TableCell>
              <TableCell align="right"><strong>コスト</strong></TableCell>
              <TableCell align="right"><strong>予算上限</strong></TableCell>
              <TableCell><strong>許可モデル</strong></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                  ユーザーがありません
                </TableCell>
              </TableRow>
            ) : (
              users.map((user) => (
                <TableRow key={user.user_id} hover>
                  <TableCell>{user.user_id}</TableCell>
                  <TableCell align="right">${(user.spend || 0).toFixed(4)}</TableCell>
                  <TableCell align="right">
                    {user.max_budget ? `$${user.max_budget}` : '無制限'}
                  </TableCell>
                  <TableCell>
                    {user.models && user.models.length > 0 ? (
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        {user.models.map((model) => (
                          <Chip key={model} label={model} size="small" />
                        ))}
                      </Box>
                    ) : (
                      <Typography variant="body2" color="text.secondary">すべて</Typography>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>新規ユーザー作成</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="ユーザーID"
            fullWidth
            value={newUser.userId}
            onChange={(e) => setNewUser({ ...newUser, userId: e.target.value })}
            required
          />
          <TextField
            margin="dense"
            label="予算上限 (USD)"
            type="number"
            fullWidth
            value={newUser.maxBudget}
            onChange={(e) => setNewUser({ ...newUser, maxBudget: e.target.value })}
            helperText="空白の場合は無制限"
          />
          <FormControl fullWidth margin="dense">
            <InputLabel>許可モデル</InputLabel>
            <Select
              multiple
              value={newUser.models}
              onChange={(e) => setNewUser({ ...newUser, models: e.target.value as string[] })}
              input={<OutlinedInput label="許可モデル" />}
              renderValue={(selected) => (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {selected.map((value) => (
                    <Chip key={value} label={value} size="small" />
                  ))}
                </Box>
              )}
            >
              {models.map((model) => (
                <MenuItem key={model.id} value={model.id}>
                  {model.id}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>キャンセル</Button>
          <Button onClick={handleCreateUser} variant="contained" disabled={creating}>
            {creating ? '作成中...' : '作成'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={keyDialogOpen} onClose={() => setKeyDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>APIキーが生成されました</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            このキーは一度しか表示されません。安全な場所に保存してください。
          </Typography>
          <Paper sx={{ p: 2, mt: 2, bgcolor: 'grey.100', position: 'relative' }}>
            <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
              {generatedKey}
            </Typography>
            <IconButton
              size="small"
              onClick={() => copyToClipboard(generatedKey)}
              sx={{ position: 'absolute', top: 8, right: 8 }}
            >
              <ContentCopy fontSize="small" />
            </IconButton>
          </Paper>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setKeyDialogOpen(false)} variant="contained">
            閉じる
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!error} autoHideDuration={6000} onClose={() => setError('')}>
        <Alert severity="error" onClose={() => setError('')}>
          {error}
        </Alert>
      </Snackbar>

      <Snackbar open={!!success} autoHideDuration={3000} onClose={() => setSuccess('')}>
        <Alert severity="success" onClose={() => setSuccess('')}>
          {success}
        </Alert>
      </Snackbar>
    </Box>
  );
}

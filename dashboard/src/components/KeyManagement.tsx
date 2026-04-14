import { useState, useEffect } from 'react';
import {
  Box,
  Button,
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
  Snackbar,
  Alert,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material';
import { Delete } from '@mui/icons-material';
import { ApiClient } from '../api';
import { ApiKey } from '../types';

interface KeyManagementProps {
  apiClient: ApiClient;
  onRefresh?: () => void;
}

export default function KeyManagement({ apiClient, onRefresh }: KeyManagementProps) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [keyToDelete, setKeyToDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const keysData = await apiClient.getKeys();
      setKeys(keysData);
    } catch (error) {
      setError('データの読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteClick = (key: string) => {
    setKeyToDelete(key);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!keyToDelete) return;

    setDeleting(true);
    try {
      await apiClient.deleteKey(keyToDelete);
      setSuccess('APIキーを削除しました');
      setDeleteDialogOpen(false);
      setKeyToDelete(null);
      loadData();
      onRefresh?.();
    } catch (error) {
      setError('APIキーの削除に失敗しました: ' + (error as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  const maskKey = (key: string) => {
    if (key.length <= 8) return '***';
    return key.substring(0, 4) + '...' + key.substring(key.length - 4);
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
        <Typography variant="h5">APIキー管理</Typography>
      </Box>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell><strong>APIキー</strong></TableCell>
              <TableCell><strong>キー名</strong></TableCell>
              <TableCell><strong>ユーザーID</strong></TableCell>
              <TableCell><strong>チームID</strong></TableCell>
              <TableCell align="right"><strong>コスト</strong></TableCell>
              <TableCell align="right"><strong>予算上限</strong></TableCell>
              <TableCell><strong>許可モデル</strong></TableCell>
              <TableCell><strong>作成日時</strong></TableCell>
              <TableCell align="center"><strong>操作</strong></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {keys.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                  APIキーがありません
                </TableCell>
              </TableRow>
            ) : (
              keys.map((key) => (
                <TableRow key={key.token} hover>
                  <TableCell sx={{ fontFamily: 'monospace' }}>{maskKey(key.token)}</TableCell>
                  <TableCell>{key.key_name || '-'}</TableCell>
                  <TableCell>{key.user_id || '-'}</TableCell>
                  <TableCell>{key.team_id || '-'}</TableCell>
                  <TableCell align="right">${(key.spend || 0).toFixed(4)}</TableCell>
                  <TableCell align="right">
                    {key.max_budget ? `$${key.max_budget}` : '無制限'}
                  </TableCell>
                  <TableCell>
                    {key.models && key.models.length > 0 ? (
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        {key.models.slice(0, 3).map((model) => (
                          <Chip key={model} label={model} size="small" />
                        ))}
                        {key.models.length > 3 && (
                          <Chip label={`+${key.models.length - 3}`} size="small" />
                        )}
                      </Box>
                    ) : (
                      <Typography variant="body2" color="text.secondary">すべて</Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    {key.created_at
                      ? new Date(key.created_at).toLocaleDateString('ja-JP')
                      : '-'}
                  </TableCell>
                  <TableCell align="center">
                    <Button
                      size="small"
                      color="error"
                      startIcon={<Delete />}
                      onClick={() => handleDeleteClick(key.token)}
                    >
                      削除
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>APIキーの削除</DialogTitle>
        <DialogContent>
          <DialogContentText>
            このAPIキーを削除してもよろしいですか？この操作は取り消せません。
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>キャンセル</Button>
          <Button onClick={handleDeleteConfirm} color="error" variant="contained" disabled={deleting}>
            {deleting ? '削除中...' : '削除'}
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

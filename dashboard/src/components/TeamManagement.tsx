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
} from '@mui/material';
import { Add } from '@mui/icons-material';
import { ApiClient } from '../api';
import { Team, Model } from '../types';

interface TeamManagementProps {
  apiClient: ApiClient;
  onRefresh?: () => void;
}

export default function TeamManagement({ apiClient, onRefresh }: TeamManagementProps) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newTeam, setNewTeam] = useState({
    teamAlias: '',
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
      const [teamsData, modelsData] = await Promise.all([
        apiClient.getTeams(),
        apiClient.getModels(),
      ]);
      setTeams(teamsData);
      setModels(modelsData);
    } catch (error) {
      setError('データの読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTeam = async () => {
    if (!newTeam.teamAlias) {
      setError('チーム名を入力してください');
      return;
    }

    setCreating(true);
    try {
      await apiClient.createTeam(
        newTeam.teamAlias,
        newTeam.maxBudget ? parseFloat(newTeam.maxBudget) : undefined,
        newTeam.models.includes('__ALL__') ? undefined : (newTeam.models.length > 0 ? newTeam.models : undefined)
      );

      setDialogOpen(false);
      setNewTeam({ teamAlias: '', maxBudget: '', models: [] });
      setSuccess('チームを作成しました');
      loadData();
      onRefresh?.();
    } catch (error) {
      setError('チームの作成に失敗しました: ' + (error as Error).message);
    } finally {
      setCreating(false);
    }
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
        <Typography variant="h5">チーム管理</Typography>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => setDialogOpen(true)}
        >
          新規チーム作成
        </Button>
      </Box>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell><strong>チームID</strong></TableCell>
              <TableCell><strong>チーム名</strong></TableCell>
              <TableCell align="right"><strong>コスト</strong></TableCell>
              <TableCell align="right"><strong>予算上限</strong></TableCell>
              <TableCell><strong>許可モデル</strong></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {teams.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                  チームがありません
                </TableCell>
              </TableRow>
            ) : (
              teams.map((team) => (
                <TableRow key={team.team_id} hover>
                  <TableCell>{team.team_id}</TableCell>
                  <TableCell>{team.team_alias || '-'}</TableCell>
                  <TableCell align="right">${(team.spend || 0).toFixed(4)}</TableCell>
                  <TableCell align="right">
                    {team.max_budget ? `$${team.max_budget}` : '無制限'}
                  </TableCell>
                  <TableCell>
                    {team.models && team.models.length > 0 ? (
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        {team.models.map((model) => (
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
        <DialogTitle>新規チーム作成</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="チーム名"
            fullWidth
            value={newTeam.teamAlias}
            onChange={(e) => setNewTeam({ ...newTeam, teamAlias: e.target.value })}
            required
          />
          <TextField
            margin="dense"
            label="予算上限 (USD)"
            type="number"
            fullWidth
            value={newTeam.maxBudget}
            onChange={(e) => setNewTeam({ ...newTeam, maxBudget: e.target.value })}
            helperText="空白の場合は無制限"
          />
          <FormControl fullWidth margin="dense">
            <InputLabel>許可モデル</InputLabel>
            <Select
              multiple
              value={newTeam.models}
              onChange={(e) => {
                const val = e.target.value as string[];
                if (val.includes('__ALL__')) {
                  setNewTeam({ ...newTeam, models: ['__ALL__'] });
                } else {
                  setNewTeam({ ...newTeam, models: val });
                }
              }}
              input={<OutlinedInput label="許可モデル" />}
              renderValue={(selected) => (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {selected.includes('__ALL__') ? (
                    <Chip label="すべてのモデル" size="small" color="primary" />
                  ) : (
                    selected.map((value) => (
                      <Chip key={value} label={value} size="small" />
                    ))
                  )}
                </Box>
              )}
            >
              <MenuItem value="__ALL__">
                <strong>すべてのモデル</strong>
              </MenuItem>
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
          <Button onClick={handleCreateTeam} variant="contained" disabled={creating}>
            {creating ? '作成中...' : '作成'}
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

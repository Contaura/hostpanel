import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { getJob, listJobs } from '../background-jobs';

const router = Router();

router.get('/', (req: AuthRequest, res: Response) => {
  res.json(listJobs({ status: req.query.status as string | undefined, type: req.query.type as string | undefined }));
});

router.get('/:id', (req: AuthRequest, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid job id' });
  const job = getJob(id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

export default router;

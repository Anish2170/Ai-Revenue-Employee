import type { RequestHandler } from 'express';
export function recoveryWrite(path: string, method: string): boolean {
  const p = path.replace(new RegExp('/+$'), '');
  return !['GET','HEAD','OPTIONS'].includes(method.toUpperCase()) && (p === '/ingest' || p === '/api' || p.startsWith('/api/'));
}
export function recoveryGuard(authenticate: RequestHandler): RequestHandler {
  return (req, res, next) => {
    if (!recoveryWrite(req.path, req.method)) return next();
    const reject = () => { res.setHeader('Retry-After','60'); res.status(503).json({ error: { code: 'recovery_read_only', message: 'Recovery mode: knowledge processing and dashboard changes are paused. Published knowledge remains available.' } }); };
    if (req.path.startsWith('/api')) { Promise.resolve(authenticate(req,res,() => reject())).catch(next); return; }
    reject();
  };
}

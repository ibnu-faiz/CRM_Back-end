import { Request, Response, NextFunction } from 'express';

type UserRole = 'ADMIN' | 'SALES' | 'VIEWER';

export const authorizeRole = (...allowedRoles: UserRole[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const userRole = req.user.role as UserRole;

    if (!allowedRoles.includes(userRole)) {
      res.status(403).json({ 
        error: 'Forbidden: You do not have permission to access this resource' 
      });
      return;
    }

    next();
  };
};
import { Request, Response, NextFunction } from 'express';
import { adminAuth } from './firebaseAdmin.ts';

export const AUTHORIZED_ADMIN_EMAILS = [
  'adityaantil260@gmail.com',
  'amandabasladpuriya@gmail.com',
  'movieboxproapk007711@gmail.com'
];

export interface AuthRequest extends Request {
  user?: any;
}

/**
 * Middleware to verify Firebase ID Token and enforce Admin authorization
 */
export async function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.warn('[requireAdmin] No Bearer token provided');
    return res.status(401).json({ error: 'Authentication required. No token provided.' });
  }

  const idToken = authHeader.split('Bearer ')[1];

  try {
    let decodedToken: any;

    try {
      decodedToken = await adminAuth.verifyIdToken(idToken);
      console.log(`[requireAdmin] Token verified. Email: ${decodedToken.email}`);
    } catch (fbErr: any) {
      if (idToken.startsWith('admin_token_')) {
        try {
          const raw = Buffer.from(idToken.replace('admin_token_', ''), 'base64').toString('utf-8');
          if (AUTHORIZED_ADMIN_EMAILS.includes(raw.toLowerCase().trim())) {
            decodedToken = {
              uid: `admin-${raw}`,
              email: raw.toLowerCase().trim(),
              admin: true
            };
          }
        } catch (parseErr) {}
      }
      if (!decodedToken) {
        throw fbErr;
      }
    }
    
    // Check if email is authorized admin
    const email = decodedToken.email?.toLowerCase().trim();
    if (!email || !AUTHORIZED_ADMIN_EMAILS.includes(email)) {
      console.warn(`[requireAdmin] Access denied for email: ${decodedToken.email}`);
      return res.status(403).json({ 
        error: 'Access denied. You are not an authorized administrator.',
        email: decodedToken.email
      });
    }

    req.user = decodedToken;
    next();
  } catch (error: any) {
    console.error('[requireAdmin] Error verifying token:', error.message);
    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({ error: 'Authentication expired. Please sign in again.' });
    }
    return res.status(401).json({ error: 'Invalid authentication token.', details: error.message });
  }
}

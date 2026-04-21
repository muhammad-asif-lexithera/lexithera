// middleware/auth.js - Authentication middleware

import { verifyToken } from '../utils/jwt.js';
import { findUserById } from '../database.js';

/**
 * Middleware to verify JWT token and attach user to request
 */
export async function authenticateToken(req, res, next) {
    // Get token from Authorization header
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
        return res.status(401).json({
            success: false,
            error: 'Access token required'
        });
    }

    try {
        // Verify token
        const decoded = verifyToken(token);

        // Get user from database to ensure they still exist and are active
        const user = await findUserById(decoded.userId);

        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'User not found'
            });
        }

        if (user.status !== 'active') {
            return res.status(403).json({
                success: false,
                error: 'Account is inactive'
            });
        }

        // Attach user to request (without password hash)
        req.user = {
            id: user.id,
            email: user.email,
            fullName: user.full_name,
            role: user.role,
            phone: user.phone,
            dob: user.dob,
            status: user.status
        };

        next();
    } catch (error) {
        return res.status(403).json({
            success: false,
            error: error.message || 'Invalid or expired token'
        });
    }
}

/**
 * Optional authentication - attach user if token present, but don't require it
 */
export async function optionalAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
        try {
            const decoded = verifyToken(token);
            const user = await findUserById(decoded.userId);

            if (user && user.status === 'active') {
                req.user = {
                    id: user.id,
                    email: user.email,
                    fullName: user.full_name,
                    role: user.role
                };
            }
        } catch (error) {
            // Silently fail for optional auth
        }
    }

    next();
}

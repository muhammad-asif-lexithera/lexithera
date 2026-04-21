// middleware/roleAuth.js - Role-based authorization middleware

/**
 * Middleware to check if user has required role(s)
 * @param {string|string[]} allowedRoles - Single role or array of allowed roles
 */
export function requireRole(allowedRoles) {
    // Normalize to array
    const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

    return (req, res, next) => {
        // Check if user is authenticated (should be set by authenticateToken middleware)
        if (!req.user) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        // Check if user has one of the allowed roles
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                error: 'Access denied. Insufficient permissions.'
            });
        }

        next();
    };
}

/**
 * Shortcut middleware for admin-only routes
 */
export const requireAdmin = requireRole('admin');

/**
 * Shortcut middleware for consultant-only routes
 */
export const requireConsultant = requireRole('consultant');

/**
 * Shortcut middleware for patient-only routes
 */
export const requirePatient = requireRole('patient');

/**
 * Middleware for routes accessible by consultants and admins
 */
export const requireConsultantOrAdmin = requireRole(['consultant', 'admin']);

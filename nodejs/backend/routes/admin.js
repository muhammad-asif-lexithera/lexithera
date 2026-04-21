// routes/admin.js - Admin routes for managing doctors/consultants

import express from 'express';
import { createUser, getUsersByRole, updateUserStatus, deleteUser, findUserById, getPendingPatients, assignDoctorToPatient, getAdminAnalytics, getAllSessions } from '../database.js';
import { authenticateToken } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/roleAuth.js';

const router = express.Router();

// All admin routes require authentication and admin role
router.use(authenticateToken);
router.use(requireAdmin);

/**
 * POST /api/admin/create-doctor
 * Create a new doctor/consultant account
 */
router.post('/create-doctor', async (req, res) => {
    try {
        const { email, password, fullName, phone } = req.body;

        // Validate required fields
        if (!email || !password || !fullName) {
            return res.status(400).json({
                success: false,
                error: 'Email, password, and full name are required'
            });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid email format'
            });
        }

        // Validate password strength
        if (password.length < 8) {
            return res.status(400).json({
                success: false,
                error: 'Password must be at least 8 characters long'
            });
        }

        // Create consultant/doctor user
        const doctor = await createUser({
            email: email.toLowerCase().trim(),
            password,
            fullName: fullName.trim(),
            role: 'consultant',
            phone: phone?.trim() || null
        });

        res.status(201).json({
            success: true,
            message: 'Doctor account created successfully',
            doctor: {
                id: doctor.id,
                email: doctor.email,
                fullName: doctor.fullName,
                role: doctor.role,
                phone: doctor.phone
            }
        });

    } catch (error) {
        console.error('Create doctor error:', error);

        if (error.message === 'Email already exists') {
            return res.status(409).json({
                success: false,
                error: 'Email already registered'
            });
        }

        res.status(500).json({
            success: false,
            error: 'Failed to create doctor account'
        });
    }
});

/**
 * POST /api/admin/create-patient
 * Create a new patient account manually (Admin only)
 */
router.post('/create-patient', async (req, res) => {
    try {
        const { email, password, fullName, phone, dob, medicalHistory, doctorId } = req.body;

        if (!email || !password || !fullName) {
            return res.status(400).json({
                success: false,
                error: 'Email, password, and full name are required'
            });
        }

        const patient = await createUser({
            email: email.toLowerCase().trim(),
            password,
            fullName: fullName.trim(),
            role: 'patient',
            phone: phone?.trim() || null,
            dob: dob || null,
            medicalHistory: medicalHistory?.trim() || null,
            status: 'active', // Manually added patients are active by default
            doctorId: doctorId || null
        });

        res.status(201).json({
            success: true,
            message: 'Patient account created successfully',
            patient: {
                id: patient.id,
                email: patient.email,
                fullName: patient.fullName
            }
        });

    } catch (error) {
        console.error('Create patient error:', error);
        if (error.message === 'Email already exists') {
            return res.status(409).json({ success: false, error: 'Email already registered' });
        }
        res.status(500).json({ success: false, error: 'Failed to create patient account' });
    }
});

/**
 * GET /api/admin/doctors
 * Get list of all doctors/consultants
 */
router.get('/doctors', async (req, res) => {
    try {
        const doctors = await getUsersByRole('consultant');

        res.json({
            success: true,
            doctors: doctors.map(doc => ({
                id: doc.id,
                email: doc.email,
                fullName: doc.fullName,
                phone: doc.phone,
                status: doc.status,
                createdAt: doc.createdAt
            }))
        });

    } catch (error) {
        console.error('Get doctors error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch doctors'
        });
    }
});

/**
 * GET /api/admin/patients
 * Get list of all patients (active, inactive, pending)
 */
router.get('/patients', async (req, res) => {
    try {
        const { getRegisteredPatientsWithDoctors } = await import('../database.js');
        const patients = await getRegisteredPatientsWithDoctors();

        res.json({
            success: true,
            patients: patients.map(p => ({
                id: p.id,
                email: p.email,
                fullName: p.fullName,
                status: p.status,
                assignedDifficulty: p.assignedDifficulty,
                createdAt: p.createdAt,
                doctorName: p.doctorName
            }))
        });

    } catch (error) {
        console.error('Get all patients error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch patients'
        });
    }
});

/**
 * GET /api/admin/pending-patients
 * Get list of all patients awaiting approval
 */
router.get('/pending-patients', async (req, res) => {
    try {
        const patients = await getPendingPatients();
        console.log(`[Admin] Found ${patients.length} pending registration requests`);

        res.json({
            success: true,
            patients: patients.map(patient => ({
                id: patient.id,
                email: patient.email,
                fullName: patient.fullName,
                phone: patient.phone,
                dob: patient.dob,
                medicalHistory: patient.medicalHistory,
                createdAt: patient.createdAt
            }))
        });

    } catch (error) {
        console.error('Get pending patients error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch pending patients'
        });
    }
});

/**
 * PUT /api/admin/patients/:id/approve
 * Approve patient and assign doctor
 */
router.put('/patients/:id/approve', async (req, res) => {
    try {
        const { id } = req.params;
        const { doctorId } = req.body;

        if (!doctorId) {
            return res.status(400).json({
                success: false,
                error: 'Doctor assignment is required for approval'
            });
        }

        const success = await assignDoctorToPatient(id, doctorId);

        if (!success) {
            return res.status(500).json({
                success: false,
                error: 'Failed to approve patient'
            });
        }

        res.json({
            success: true,
            message: 'Patient approved and assigned to doctor successfully'
        });

    } catch (error) {
        console.error('Approve patient error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to approve patient'
        });
    }
});

/**
 * PUT /api/admin/doctors/:id/status
 * Update doctor status (activate/deactivate)
 */
router.put('/doctors/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        // Validate status
        if (!['active', 'inactive'].includes(status)) {
            return res.status(400).json({
                success: false,
                error: 'Status must be either "active" or "inactive"'
            });
        }

        // Check if doctor exists
        const doctor = await findUserById(id);
        if (!doctor || doctor.role !== 'consultant') {
            return res.status(404).json({
                success: false,
                error: 'Doctor not found'
            });
        }

        // Update status
        const updated = await updateUserStatus(id, status);

        if (!updated) {
            return res.status(500).json({
                success: false,
                error: 'Failed to update status'
            });
        }

        res.json({
            success: true,
            message: `Doctor account ${status === 'active' ? 'activated' : 'deactivated'} successfully`
        });

    } catch (error) {
        console.error('Update doctor status error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update doctor status'
        });
    }
});

/**
 * DELETE /api/admin/doctors/:id
 * Delete doctor account
 */
/**
 * DELETE /api/admin/patients/:id
 * Delete patient account (Reject registration)
 */
router.delete('/patients/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Check if patient exists
        const patient = await findUserById(id);
        if (!patient || patient.role !== 'patient') {
            return res.status(404).json({
                success: false,
                error: 'Patient not found'
            });
        }

        // Delete patient
        const deleted = await deleteUser(id);

        if (!deleted) {
            return res.status(500).json({
                success: false,
                error: 'Failed to delete patient'
            });
        }

        res.json({
            success: true,
            message: 'Patient registration request deleted successfully'
        });

    } catch (error) {
        console.error('Delete patient error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete patient'
        });
    }
});

router.delete('/doctors/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Check if doctor exists
        const doctor = await findUserById(id);
        if (!doctor || doctor.role !== 'consultant') {
            return res.status(404).json({
                success: false,
                error: 'Doctor not found'
            });
        }

        // Delete doctor
        const deleted = await deleteUser(id);

        if (!deleted) {
            return res.status(500).json({
                success: false,
                error: 'Failed to delete doctor'
            });
        }

        res.json({
            success: true,
            message: 'Doctor account deleted successfully'
        });

    } catch (error) {
        console.error('Delete doctor error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete doctor'
        });
    }
});

/**
 * GET /api/admin/analytics
 * Get system-wide analytics for admin dashboard
 */
router.get('/analytics', async (req, res) => {
    try {
        const analytics = await getAdminAnalytics();

        // We could also get real-time info if we had access to the io instance
        // But for now, stats from DB are most important

        res.json({
            success: true,
            analytics
        });

    } catch (error) {
        console.error('Get analytics error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch analytics'
        });
    }
});

/**
 * GET /api/admin/live-sessions
 * Get all live sessions globally
 */
router.get('/live-sessions', async (req, res) => {
    try {
        const sessions = await getAllSessions();
        res.json({ success: true, sessions });
    } catch (error) {
        console.error('Get all sessions error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch sessions' });
    }
});

export default router;

// routes/user.js - User profile routes

import express from 'express';
import {
    getUserProfile,
    updateUserProfile,
    getPatientsByDoctor,
    getDoctorForPatient,
    savePracticeResult,
    getPracticeHistory,
    getPracticedWords,
    setPatientGoal,
    createLiveSession,
    getPatientSessions,
    getConsultantSessions,
    updateSessionStatus
} from '../database.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

console.log('✓ User routes module loaded');

// All user routes require authentication
router.use(authenticateToken);

/**
 * GET /api/user/profile
 * Get current user profile
 */
router.get('/profile', async (req, res) => {
    try {
        const profile = await getUserProfile(req.user.id);

        if (!profile) {
            return res.status(404).json({
                success: false,
                error: 'Profile not found'
            });
        }

        res.json({
            success: true,
            profile: {
                id: profile.id,
                email: profile.email,
                fullName: profile.fullName,
                role: profile.role,
                phone: profile.phone,
                dob: profile.dob,
                medicalHistory: profile.medicalHistory,
                assignedDifficulty: profile.assignedDifficulty,
                status: profile.status,
                doctorId: profile.doctorId,
                createdAt: profile.createdAt
            }
        });

    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch profile'
        });
    }
});

/**
 * PUT /api/user/profile
 * Update user profile
 */
router.put('/profile', async (req, res) => {
    try {
        const { fullName, phone, dob, medicalHistory } = req.body;

        const updates = {};
        if (fullName !== undefined) updates.full_name = fullName;
        if (phone !== undefined) updates.phone = phone;
        if (dob !== undefined) updates.dob = dob;
        if (medicalHistory !== undefined) updates.medical_history = medicalHistory;

        const updated = await updateUserProfile(req.user.id, updates);

        if (!updated) {
            return res.status(500).json({
                success: false,
                error: 'Failed to update profile'
            });
        }

        // Get updated profile
        const profile = await getUserProfile(req.user.id);

        res.json({
            success: true,
            message: 'Profile updated successfully',
            profile: {
                id: profile.id,
                email: profile.email,
                fullName: profile.full_name,
                role: profile.role,
                phone: profile.phone,
                dob: profile.dob,
                medicalHistory: profile.medical_history
            }
        });

    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update profile'
        });
    }
});

/**
 * GET /api/user/consultants
 * Get assigned consultant for patient
 */
router.get('/consultants', async (req, res) => {
    try {
        if (req.user.role === 'patient') {
            const { getDoctorForPatient } = await import('../database.js');
            const doctor = await getDoctorForPatient(req.user.id);
            return res.json({
                success: true,
                consultants: doctor ? [{
                    id: doctor.id,
                    fullName: doctor.fullName,
                    specialty: doctor.specialty,
                    status: 'active'
                }] : []
            });
        }

        const { getAllConsultants } = await import('../database.js');
        const consultants = await getAllConsultants();

        res.json({
            success: true,
            consultants: consultants.map(c => ({
                id: c.id,
                fullName: c.full_name,
                specialty: c.specialty || 'Speech Therapy Specialist',
                status: c.status
            }))
        });

    } catch (error) {
        console.error('Get consultants error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch consultants'
        });
    }
});

/**
 * GET /api/user/patients
 * Get patients for a consultant
 */
router.get('/patients', async (req, res) => {
    try {
        let patients = [];
        if (req.user.role === 'consultant') {
            patients = await getPatientsByDoctor(req.user.id);
        } else {
            const { getAllPatients } = await import('../database.js');
            patients = await getAllPatients();
        }

        res.json({
            success: true,
            patients: patients.map(p => ({
                id: p.id,
                fullName: p.fullName,
                status: p.status,
                assignedDifficulty: p.assignedDifficulty,
                createdAt: p.createdAt,
                doctorId: p.doctorId
            }))
        });

    } catch (error) {
        console.error('Get patients error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch patients'
        });
    }
});

/**
 * GET /api/user/patient-report/:id
 * Get patient report data (history and stats)
 */
router.get('/patient-report/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Verify access (admin or assigned doctor)
        if (req.user.role === 'consultant') {
            const patient = await getUserProfile(id);
            if (!patient || patient.doctorId !== req.user.id) {
                return res.status(403).json({ success: false, error: 'Access denied' });
            }
        }

        const patient = await getUserProfile(id);
        const history = await getPracticeHistory(id);

        res.json({
            success: true,
            patient,
            history
        });

    } catch (error) {
        console.error('Get patient report error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch report' });
    }
});

/**
 * POST /api/user/practice-result
 * Save practice session data
 */
router.post('/practice-result', async (req, res) => {
    try {
        const { word, accuracy, confidence, errors } = req.body;

        if (!word) {
            return res.status(400).json({ success: false, error: 'Word is required' });
        }

        const resultId = await savePracticeResult({
            patientId: req.user.id,
            word,
            accuracy,
            confidence,
            errors
        });

        res.json({
            success: true,
            id: resultId
        });
    } catch (error) {
        console.error('Save practice result error:', error);
        res.status(500).json({ success: false, error: 'Failed to save result' });
    }
});

/**
 * GET /api/user/practice-history
 * Get practice history for graph
 */
router.get('/practice-history', async (req, res) => {
    try {
        const { word, days = 30 } = req.query;
        const history = await getPracticeHistory(req.user.id, word, days);

        res.json({
            success: true,
            history
        });
    } catch (error) {
        console.error('Get practice history error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch history' });
    }
});

/**
 * GET /api/user/practiced-words
 * Get list of words practiced by the patient
 */
router.get('/practiced-words', async (req, res) => {
    try {
        const words = await getPracticedWords(req.user.id);
        res.json({
            success: true,
            words: words.map(w => w.word)
        });
    } catch (error) {
        console.error('Get practiced words error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch words' });
    }
});

/**
 * POST /api/user/assign-goal
 * Assign a difficulty goal to a patient (Consultant or Admin only)
 */
router.post('/assign-goal', async (req, res) => {
    try {
        const { patientId, difficulty } = req.body;

        if (!patientId || !difficulty) {
            return res.status(400).json({ success: false, error: 'patientId and difficulty are required' });
        }

        // Validate difficulty
        if (!['Basic', 'Medium', 'Hard'].includes(difficulty)) {
            return res.status(400).json({ success: false, error: 'Invalid difficulty level' });
        }

        // Authorization: Consultant can only assign to their patients, Admin can assign to anyone
        if (req.user.role === 'consultant') {
            const patient = await getUserProfile(patientId);
            if (!patient || patient.doctorId !== req.user.id) {
                return res.status(403).json({ success: false, error: 'Access denied: Patient not assigned to you' });
            }
        } else if (req.user.role !== 'admin') {
            return res.status(403).json({ success: false, error: 'Unauthorized: Only consultants and admins can assign goals' });
        }

        const success = await setPatientGoal(patientId, difficulty);

        if (!success) {
            return res.status(500).json({ success: false, error: 'Failed to assign goal' });
        }

        res.json({ success: true, message: 'Goal assigned successfully' });
    } catch (error) {
        console.error('Assign goal error:', error);
        res.status(500).json({ success: false, error: 'Failed to assign goal' });
    }
});

/**
 * POST /api/user/live-sessions
 * Create a new live session request
 */
router.post('/live-sessions', async (req, res) => {
    try {
        const { consultantId, date, time, notes } = req.body;

        if (!consultantId || !date || !time) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }

        const patientId = req.user.id;
        
        await createLiveSession({
            patientId,
            consultantId,
            date,
            time,
            notes
        });

        res.json({ success: true, message: 'Session requested successfully' });
    } catch (error) {
        console.error('Create live session error:', error);
        res.status(500).json({ success: false, error: error.message || 'Failed to request session' });
    }
});

/**
 * GET /api/user/live-sessions
 * Get sessions for the current user (patient or consultant)
 */
router.get('/live-sessions', async (req, res) => {
    try {
        let sessions = [];
        if (req.user.role === 'patient') {
            sessions = await getPatientSessions(req.user.id);
        } else if (req.user.role === 'consultant') {
            sessions = await getConsultantSessions(req.user.id);
        } else {
            return res.status(400).json({ success: false, error: 'Invalid user role' });
        }

        res.json({ success: true, sessions });
    } catch (error) {
        console.error('Get live sessions error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch sessions' });
    }
});

/**
 * PATCH /api/user/live-sessions/:id/status
 * Update the status of a live session
 */
router.patch('/live-sessions/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!['accepted', 'rejected', 'completed'].includes(status)) {
            return res.status(400).json({ success: false, error: 'Invalid status' });
        }

        // Must be consultant or admin to update status
        if (req.user.role !== 'consultant' && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, error: 'Unauthorized to update session status' });
        }

        await updateSessionStatus(id, status);

        res.json({ success: true, message: 'Session status updated successfully' });
    } catch (error) {
        console.error('Update session status error:', error);
        res.status(500).json({ success: false, error: 'Failed to update session status' });
    }
});

export default router;

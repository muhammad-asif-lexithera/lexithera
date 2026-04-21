// routes/auth.js - Authentication routes

import express from 'express';
import { createUser, findUserByEmail, verifyPassword, supabase } from '../database.js';
import { generateToken } from '../utils/jwt.js';
// Nodemailer removed as per migration to Supabase OTP

const router = express.Router();




/**
 * POST /api/auth/register/patient
 * Patient self-registration
 */
router.post('/register/patient', async (req, res) => {
    try {
        const { email, password, fullName, phone, dob, medicalHistory } = req.body;

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

        // Create user in local database
        const user = await createUser({
            email: email.toLowerCase().trim(),
            password,
            fullName: fullName.trim(),
            role: 'patient',
            phone: phone?.trim() || null,
            dob: dob || null,
            medicalHistory: medicalHistory?.trim() || null,
            status: 'pending' // Set initial status to pending
        });

        // Also ensure user exists in Supabase Auth for OTP functionality
        // We use user_metadata to store the full name for the email template
        await supabase.auth.signUp({
            email: email.toLowerCase().trim(),
            password: password, // We can use the same password or a random one, but same is easier for future integration
            options: {
                data: {
                    full_name: fullName.trim()
                }
            }
        });

        res.status(201).json({
            success: true,
            message: 'Registration successful. Awaiting administrator approval.',
            user: {
                id: user.id,
                email: user.email,
                fullName: user.fullName,
                role: user.role
            }
        });

    } catch (error) {
        console.error('Registration error:', error);

        if (error.message === 'Email already exists') {
            return res.status(409).json({
                success: false,
                error: 'Email already registered'
            });
        }

        res.status(500).json({
            success: false,
            error: 'Registration failed'
        });
    }
});

/**
 * POST /api/auth/login
 * Universal login endpoint for all roles
 */
router.post('/login', async (req, res) => {
    try {
        const { email, password, role } = req.body;

        // Validate required fields
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                error: 'Email and password are required'
            });
        }

        // Find user by email
        const user = await findUserByEmail(email.toLowerCase().trim());
        console.log('Login attempt for:', email);

        if (!user) {
            console.log('Login failed: User not found');
            return res.status(401).json({
                success: false,
                error: 'Invalid email or password'
            });
        }

        console.log('User found:', { id: user.id, role: user.role, status: user.status });

        // Verify password
        const isPasswordValid = verifyPassword(password, user.passwordHash);
        console.log('Password valid:', isPasswordValid);

        if (!isPasswordValid) {
            console.log('Login failed: Invalid password');
            return res.status(401).json({
                success: false,
                error: 'Invalid email or password'
            });
        }

        // Check if user status is active
        if (user.status === 'pending') {
            return res.status(403).json({
                success: false,
                error: 'Your request is under process. Please wait for administrator approval.'
            });
        }

        if (user.status !== 'active') {
            return res.status(403).json({
                success: false,
                error: 'Account is inactive. Please contact administrator.'
            });
        }

        // If role is specified, verify it matches
        if (role && user.role !== role) {
            console.log('Login failed: Role mismatch. Expected:', role, 'Actual:', user.role);
            return res.status(403).json({
                success: false,
                error: `This account is not registered as a ${role}`
            });
        }

        // If user is a patient, trigger Supabase OTP flow
        if (user.role === 'patient') {
            try {
                // Ensure user has metadata for the email template before sending OTP
                // This is useful if the user was registered before this change
                await supabase.auth.admin.updateUserById(user.id, {
                    user_metadata: { full_name: user.fullName }
                }).catch(() => {
                    // Ignore error if admin API is not available or user not found yet
                    // signInWithOtp will create the user if missing
                });

                const { error: otpError } = await supabase.auth.signInWithOtp({
                    email: user.email,
                    options: {
                        data: {
                            full_name: user.fullName
                        }
                    }
                });

                if (otpError) throw otpError;

                return res.json({
                    success: true,
                    requireOtp: true,
                    email: user.email,
                    message: 'OTP sent to your email via Supabase'
                });
            } catch (emailError) {
                console.error('Failed to send OTP via Supabase:', emailError);
                return res.status(500).json({
                    success: false,
                    error: 'Failed to send OTP email. Please try again later.'
                });
            }
        }

        // Generate JWT token for other roles
        const token = generateToken({
            id: user.id,
            email: user.email,
            fullName: user.fullName,
            role: user.role
        });

        res.json({
            success: true,
            message: 'Login successful',
            token,
            user: {
                id: user.id,
                email: user.email,
                fullName: user.fullName,
                role: user.role,
                phone: user.phone,
                dob: user.dob
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            error: 'Login failed'
        });
    }
});

/**
 * POST /api/auth/verify-otp
 * Verify OTP for patient login
 */
router.post('/verify-otp', async (req, res) => {
    try {
        const { email, otp } = req.body;

        if (!email || !otp) {
            return res.status(400).json({ success: false, error: 'Email and OTP are required' });
        }

        const user = await findUserByEmail(email.toLowerCase().trim());

        if (!user || user.role !== 'patient') {
            return res.status(401).json({ success: false, error: 'Invalid request' });
        }

        // Verify OTP using Supabase Auth
        const { data: { session }, error: verifyError } = await supabase.auth.verifyOtp({
            email: email.toLowerCase().trim(),
            token: otp,
            type: 'email' // or 'signup' depending on Supabase config, usually 'email' for OTP
        });

        if (verifyError || !session) {
            console.error('Supabase OTP Verification error:', verifyError);
            return res.status(401).json({ success: false, error: verifyError?.message || 'Invalid or expired OTP' });
        }

        // Generate JWT token
        const token = generateToken({
            id: user.id,
            email: user.email,
            fullName: user.fullName,
            role: user.role
        });

        res.json({
            success: true,
            message: 'Verification successful',
            token,
            user: {
                id: user.id,
                email: user.email,
                fullName: user.fullName,
                role: user.role,
                phone: user.phone,
                dob: user.dob
            }
        });
    } catch (error) {
        console.error('OTP Verification error:', error);
        res.status(500).json({ success: false, error: 'Verification failed' });
    }
});

/**
 * POST /api/auth/resend-otp
 * Resend OTP for patient login
 */
router.post('/resend-otp', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ success: false, error: 'Email is required' });
        }

        const user = await findUserByEmail(email.toLowerCase().trim());

        if (!user || user.role !== 'patient') {
            return res.status(401).json({ success: false, error: 'Invalid request' });
        }

        const { error: otpError } = await supabase.auth.signInWithOtp({
            email: user.email,
            options: {
                data: {
                    full_name: user.fullName
                }
            }
        });

        if (otpError) throw otpError;

        res.json({
            success: true,
            message: 'OTP resent successfully via Supabase'
        });
    } catch (error) {
        console.error('Resend OTP error:', error);
        res.status(500).json({ success: false, error: 'Failed to resend OTP' });
    }
});

export default router;

// database.js - Supabase database setup and helper functions
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

// Export the supabase client instance
export const supabase = createClient(
    process.env.SUPABASE_URL || 'https://placeholder.supabase.co', 
    process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || 'placeholder'
);

export async function initializeDatabase() {
    console.log('✓ Supabase connection initialized (skipping local SQLite schema setup)');
}

/**
 * Custom error class matching unique constraint failed for backward compatibility
 */
class UniqueConstraintError extends Error {
    constructor(...args) {
        super(...args);
        this.message = 'UNIQUE constraint failed: users.email';
    }
}

/**
 * Create a new user
 */
export async function createUser(userData) {
    const { email, password, fullName, role, phone = null, dob = null, medicalHistory = null, status = 'active', doctorId = null } = userData;
    const passwordHash = bcrypt.hashSync(password, 10);

    const { data, error } = await supabase
        .from('users')
        .insert([{
            email,
            password_hash: passwordHash,
            full_name: fullName,
            role,
            phone,
            dob,
            medical_history: medicalHistory,
            status,
            doctor_id: doctorId
        }])
        .select()
        .single();

    if (error) {
        if (error.code === '23505') { // Postgres unique violation code
            throw new UniqueConstraintError();
        }
        throw new Error(error.message);
    }

    return {
        id: data.id,
        email: data.email,
        fullName: data.full_name,
        role: data.role,
        phone: data.phone,
        dob: data.dob,
        medicalHistory: data.medical_history,
        assignedDifficulty: data.assigned_difficulty,
        status: data.status,
        doctorId: data.doctor_id
    };
}

export async function findUserByEmail(email) {
    const { data, error } = await supabase.from('users').select('*').eq('email', email).maybeSingle();
    if (!data) return null;
    return {
        id: data.id,
        email: data.email,
        passwordHash: data.password_hash,
        fullName: data.full_name,
        role: data.role,
        phone: data.phone,
        dob: data.dob,
        medicalHistory: data.medical_history,
        assignedDifficulty: data.assigned_difficulty,
        status: data.status,
        doctorId: data.doctor_id,
        specialty: data.specialty,
        createdAt: data.created_at
    };
}

export async function findUserById(id) {
    const { data, error } = await supabase.from('users').select('*').eq('id', id).maybeSingle();
    if (!data) return null;
    return {
        id: data.id,
        email: data.email,
        passwordHash: data.password_hash,
        fullName: data.full_name,
        role: data.role,
        phone: data.phone,
        dob: data.dob,
        medicalHistory: data.medical_history,
        assignedDifficulty: data.assigned_difficulty,
        status: data.status,
        doctorId: data.doctor_id,
        specialty: data.specialty,
        createdAt: data.created_at
    };
}

export function verifyPassword(plainPassword, passwordHash) {
    return bcrypt.compareSync(plainPassword, passwordHash);
}

export async function getUsersByRole(role) {
    const { data } = await supabase
        .from('users')
        .select('id, email, full_name, phone, dob, status, specialty, created_at, doctor_id')
        .eq('role', role);
    
    return (data || []).map(u => ({
        id: u.id,
        email: u.email,
        fullName: u.full_name,
        phone: u.phone,
        dob: u.dob,
        status: u.status,
        specialty: u.specialty,
        createdAt: u.created_at,
        doctorId: u.doctor_id
    }));
}

export async function getAllConsultants() {
    const { data } = await supabase
        .from('users')
        .select('id, email, full_name, specialty, status, created_at')
        .eq('role', 'consultant');
    
    return (data || []).map(c => ({
        id: c.id,
        email: c.email,
        fullName: c.full_name,
        specialty: c.specialty,
        status: c.status,
        createdAt: c.created_at
    }));
}

export async function getAllPatients() {
    const { data } = await supabase
        .from('users')
        .select('id, email, full_name, status, assigned_difficulty, created_at, doctor:doctor_id(full_name)')
        .eq('role', 'patient');
    
    return (data || []).map(p => ({
        id: p.id,
        email: p.email,
        fullName: p.full_name,
        status: p.status,
        assignedDifficulty: p.assigned_difficulty,
        createdAt: p.created_at,
        doctorName: p.doctor ? p.doctor.full_name : null
    }));
}

export async function getRegisteredPatientsWithDoctors() {
    const { data } = await supabase
        .from('users')
        .select(`
            id, email, full_name, status, created_at, assigned_difficulty,
            doctor:doctor_id (full_name)
        `)
        .eq('role', 'patient')
        .neq('status', 'pending');
        
    return (data || []).map(p => ({
        id: p.id,
        email: p.email,
        fullName: p.full_name,
        status: p.status,
        createdAt: p.created_at,
        assignedDifficulty: p.assigned_difficulty,
        doctorName: p.doctor ? p.doctor.full_name : null
    }));
}

export async function updateUserStatus(userId, status) {
    const { error } = await supabase
        .from('users')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', userId);
    return !error;
}

export async function updateUserProfile(userId, updates) {
    const allowedFields = ['full_name', 'phone', 'dob', 'medical_history'];
    const updatePayload = {};

    Object.keys(updates).forEach(key => {
        if (allowedFields.includes(key)) updatePayload[key] = updates[key];
    });

    if (Object.keys(updatePayload).length === 0) return false;
    updatePayload.updated_at = new Date().toISOString();

    const { error } = await supabase.from('users').update(updatePayload).eq('id', userId);
    return !error;
}

export async function deleteUser(userId) {
    const { error: prErr } = await supabase.from('practice_results').delete().eq('patient_id', userId);
    const { error: docErr } = await supabase.from('users').update({ doctor_id: null }).eq('doctor_id', userId);
    const { error } = await supabase.from('users').delete().eq('id', userId);
    return !error;
}

export async function getPendingPatients() {
    const { data } = await supabase
        .from('users')
        .select('id, email, full_name, phone, dob, medical_history, created_at')
        .eq('role', 'patient')
        .eq('status', 'pending');
    
    return (data || []).map(p => ({
        id: p.id,
        email: p.email,
        fullName: p.full_name,
        phone: p.phone,
        dob: p.dob,
        medicalHistory: p.medical_history,
        createdAt: p.created_at
    }));
}

export async function assignDoctorToPatient(patientId, doctorId) {
    const { error } = await supabase
        .from('users')
        .update({ doctor_id: doctorId, status: 'active', updated_at: new Date().toISOString() })
        .eq('id', patientId)
        .eq('role', 'patient');
    return !error;
}

export async function setPatientGoal(patientId, difficulty) {
    const { error } = await supabase
        .from('users')
        .update({ assigned_difficulty: difficulty, updated_at: new Date().toISOString() })
        .eq('id', patientId)
        .eq('role', 'patient');
    return !error;
}

export async function getPatientsByDoctor(doctorId) {
    const { data } = await supabase
        .from('users')
        .select('id, email, full_name, status, assigned_difficulty, created_at')
        .eq('role', 'patient')
        .eq('doctor_id', doctorId);
    
    return (data || []).map(p => ({
        id: p.id,
        email: p.email,
        fullName: p.full_name,
        status: p.status,
        assignedDifficulty: p.assigned_difficulty,
        createdAt: p.created_at
    }));
}

export async function getDoctorForPatient(patientId) {
    const { data } = await supabase
        .from('users')
        .select('doctor:doctor_id(id, full_name, email, specialty)')
        .eq('id', patientId)
        .eq('role', 'patient')
        .single();
    
    if (!data || !data.doctor) return null;
    
    return {
        id: data.doctor.id,
        fullName: data.doctor.full_name,
        email: data.doctor.email,
        specialty: data.doctor.specialty || 'Speech Therapy Specialist'
    };
}

export async function getUserProfile(userId) {
    const { data } = await supabase
        .from('users')
        .select('id, email, full_name, role, phone, dob, medical_history, status, assigned_difficulty, doctor_id, created_at, doctor:doctor_id(full_name)')
        .eq('id', userId)
        .single();

    if (!data) return null;
    return {
        id: data.id,
        email: data.email,
        fullName: data.full_name,
        role: data.role,
        phone: data.phone,
        dob: data.dob,
        medicalHistory: data.medical_history,
        status: data.status,
        assignedDifficulty: data.assigned_difficulty,
        doctorId: data.doctor_id,
        createdAt: data.created_at,
        doctorName: data.doctor ? data.doctor.full_name : null
    };
}

export async function savePracticeResult(resultData) {
    const { patientId, word, accuracy, confidence, errors } = resultData;
    const { data, error } = await supabase
        .from('practice_results')
        .insert([{ patient_id: patientId, word, accuracy, confidence, errors }])
        .select()
        .single();
    if (error) throw new Error(error.message);
    return data.id;
}

export async function getPracticeHistory(patientId, word = null, days = 30) {
    const dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() - days);

    let query = supabase
        .from('practice_results')
        .select('*')
        .eq('patient_id', patientId)
        .gte('created_at', dateLimit.toISOString())
        .order('created_at', { ascending: true });

    if (word) {
        query = query.eq('word', word);
    }

    const { data } = await query;
    return (data || []).map(r => ({
        id: r.id,
        patientId: r.patient_id,
        word: r.word,
        accuracy: r.accuracy,
        confidence: r.confidence,
        errors: r.errors,
        createdAt: r.created_at
    }));
}

export async function getPracticedWords(patientId) {
    // Supabase has no SELECT DISTINCT out of the box with sdk unless using rpc.
    // Instead we fetch all words and filter in js since history isn't normally millions per user.
    const { data } = await supabase
        .from('practice_results')
        .select('word')
        .eq('patient_id', patientId)
        .order('word', { ascending: true });
        
    if (!data) return [];
    const unique = [...new Set(data.map(d => d.word))];
    return unique.map(w => ({ word: w }));
}

export async function getAdminAnalytics() {
    // Note: Analytics with complex grouping is limited in raw Supabase JS client.
    // We fetch and group here, or use simple select aggregations if possible.
    const { data: users } = await supabase.from('users').select('role, created_at, doctor_id, id, full_name');
    const { data: results } = await supabase.from('practice_results').select('word, accuracy, confidence');

    const userCounts = [
        { role: 'admin', count: (users || []).filter(u => u.role === 'admin').length },
        { role: 'consultant', count: (users || []).filter(u => u.role === 'consultant').length },
        { role: 'patient', count: (users || []).filter(u => u.role === 'patient').length }
    ];

    // User growth (crude months)
    const growthMap = {};
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    (users || []).forEach(u => {
        const d = new Date(u.created_at);
        if (d >= sixMonthsAgo) {
            const m = d.toISOString().substring(0, 7);
            growthMap[m] = (growthMap[m] || 0) + 1;
        }
    });
    const userGrowth = Object.entries(growthMap).sort().map(([month, count]) => ({ month, count }));

    // Word stats
    const wordMap = {};
    (results || []).forEach(r => {
        if (!wordMap[r.word]) wordMap[r.word] = { count: 0, totalAccuracy: 0 };
        wordMap[r.word].count++;
        wordMap[r.word].totalAccuracy += r.accuracy;
    });
    const wordStats = Object.entries(wordMap)
        .map(([word, stats]) => ({ word, count: stats.count, avgAccuracy: stats.totalAccuracy / stats.count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

    // Consultant performance
    const cMap = {};
    (users || []).filter(u => u.role === 'consultant').forEach(c => {
        cMap[c.id] = { name: c.full_name, patientCount: 0 };
    });
    (users || []).forEach(u => {
        if (u.doctor_id && cMap[u.doctor_id]) cMap[u.doctor_id].patientCount++;
    });
    const consultantStats = Object.values(cMap);

    // Overall Metrics
    let avgAcc = 0, avgConf = 0, count = 0;
    (results || []).forEach(r => {
        avgAcc += r.accuracy;
        avgConf += r.confidence;
        count++;
    });
    const overallMetrics = {
        avgAccuracy: count ? avgAcc / count : 0,
        avgConfidence: count ? avgConf / count : 0,
        totalSessions: count
    };

    return { userCounts, userGrowth, wordStats, consultantStats, overallMetrics };
}

export async function createLiveSession(data) {
    const { patientId, consultantId, date, time, notes } = data;
    const { data: res, error } = await supabase
        .from('live_sessions')
        .insert([{ 
            patient_id: patientId, 
            consultant_id: consultantId, 
            session_date: date, 
            session_time: time, 
            notes: notes || null 
        }])
        .select()
        .single();
    
    if (error) {
        console.error('Supabase insert error:', error);
        throw new Error(error.message);
    }
    if (!res) throw new Error('No data returned from session creation');
    return res.id;
}

export async function getPatientSessions(patientId) {
    const { data } = await supabase
        .from('live_sessions')
        .select('*, doctor:consultant_id(full_name, specialty)')
        .eq('patient_id', patientId)
        .order('session_date', { ascending: true })
        .order('session_time', { ascending: true });
        
    return (data || []).map(s => ({
        id: s.id,
        patientId: s.patient_id,
        consultantId: s.consultant_id,
        date: s.session_date,
        time: s.session_time,
        notes: s.notes,
        status: s.status,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
        consultantName: s.doctor ? s.doctor.full_name : null,
        specialty: s.doctor ? s.doctor.specialty : null
    }));
}

export async function getConsultantSessions(consultantId) {
    const { data } = await supabase
        .from('live_sessions')
        .select('*, patient:patient_id(full_name)')
        .eq('consultant_id', consultantId)
        .order('session_date', { ascending: true })
        .order('session_time', { ascending: true });
        
    return (data || []).map(s => ({
        id: s.id,
        patientId: s.patient_id,
        consultantId: s.consultant_id,
        date: s.session_date,
        time: s.session_time,
        notes: s.notes,
        status: s.status,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
        patientName: s.patient ? s.patient.full_name : null
    }));
}

export async function getAllSessions() {
    const { data } = await supabase
        .from('live_sessions')
        .select('*, patient:patient_id(full_name), doctor:consultant_id(full_name)')
        .order('created_at', { ascending: false });
        
    return (data || []).map(s => ({
        id: s.id,
        patientId: s.patient_id,
        consultantId: s.consultant_id,
        date: s.session_date,
        time: s.session_time,
        notes: s.notes,
        status: s.status,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
        patientName: s.patient ? s.patient.full_name : null,
        consultantName: s.doctor ? s.doctor.full_name : null
    }));
}

export async function updateSessionStatus(sessionId, status) {
    const { error } = await supabase
        .from('live_sessions')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', sessionId);
    return !error;
}

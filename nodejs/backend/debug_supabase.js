import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

dotenv.config({ path: path.join(dirname(fileURLToPath(import.meta.url)), '.env') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function checkUsers() {
    const { data: users, error } = await supabase.from('users').select('id, email, role, doctor_id, full_name');
    if (error) {
        console.error('Error fetching users:', error);
        return;
    }
    console.log('Users found:', users.length);
    console.table(users);
    
    const consultants = users.filter(u => u.role === 'consultant');
    console.log('Consultants found:', consultants.length);
    
    const patientsWithDoctors = users.filter(u => u.role === 'patient' && u.doctor_id);
    console.log('Patients with doctors assigned:', patientsWithDoctors.length);
    
    if (patientsWithDoctors.length > 0) {
        patientsWithDoctors.forEach(p => {
            console.log(`Patient ${p.email} has doctor_id: ${p.doctor_id} (Type: ${typeof p.doctor_id})`);
        });
    }
    
    if (consultants.length > 0) {
        consultants.forEach(c => {
            console.log(`Consultant ${c.email} has id: ${c.id} (Type: ${typeof c.id})`);
        });
    }
}

checkUsers();

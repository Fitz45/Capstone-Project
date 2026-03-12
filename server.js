require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

// Initialize Express app
const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// In-memory store for demo (replace with persistent store in production)
const deviceUserMap = {};
const sealDetailsMap = {};

// Return session status for a device (query param: device_id)
app.get('/api/device-session/active', async (req, res) => {
  const { device_id } = req.query;
  if (!device_id) {
    return res.status(400).json({ error: 'device_id required' });
  }
  const user_id = deviceUserMap[device_id];
  if (!user_id) {
    return res.json({ active: false });
  }
  // Lookup user email (user_name) from Supabase users table
  let user_name = null;
  try {
    const { data, error } = await supabase.from('users').select('email').eq('id', user_id).single();
    if (!error && data && data.email) {
      user_name = data.email;
    }
  } catch (e) {}
  return res.json({
    active: true,
    user_id,
    user_name: user_name || '',
    device_label: device_id
  });
});

// ========== ESP32/Device Communication Endpoints ==========
// Called by app/dashboard when user logs in and selects/registers a device
app.post('/api/esp32/user-login', (req, res) => {
  const { device_id, user_id } = req.body;
  if (!device_id || !user_id) return res.status(400).json({ error: 'device_id and user_id required' });
  deviceUserMap[device_id] = user_id;
  res.json({ message: 'User login registered for device', device_id, user_id });
});

// ESP32 polls to check if a user is logged in nearby
app.get('/api/esp32/user-detected', (req, res) => {
  const { device_id } = req.query;
  if (!device_id) return res.status(400).json({ error: 'device_id required' });
  const user_id = deviceUserMap[device_id];
  if (user_id) {
    res.json({ user_id });
  } else {
    res.status(404).json({ error: 'No user detected' });
  }
});

// ESP32 notifies backend of first scan (RFID)
app.post('/api/esp32/first-scan', (req, res) => {
  const { device_id, user_id, rfid_code, access_token } = req.body;
  if (!device_id || !user_id || !rfid_code || !access_token) return res.status(400).json({ error: 'Missing required fields' });
  // Store scan event for this device/rfid
  sealDetailsMap[`${device_id}:${rfid_code}`] = { saved: false };
  res.json({ message: 'First scan registered, waiting for seal details' });
});

// App/dashboard saves seal details and notifies backend
app.post('/api/esp32/save-seal-details', (req, res) => {
  const { device_id, rfid_code, seal_number, truck_number } = req.body;
  if (!device_id || !rfid_code || !seal_number || !truck_number) return res.status(400).json({ error: 'Missing required fields' });
  // Mark as saved
  sealDetailsMap[`${device_id}:${rfid_code}`] = { saved: true };
  res.json({ message: 'Seal details saved' });
});

// ESP32 polls to check if seal details have been saved
app.get('/api/esp32/seal-details-saved', (req, res) => {
  const { device_id, rfid_uid } = req.query;
  if (!device_id || !rfid_uid) return res.status(400).json({ error: 'device_id and rfid_uid required' });
  const entry = sealDetailsMap[`${device_id}:${rfid_uid}`];
  if (entry && entry.saved) {
    res.json({ saved: true });
  } else {
    res.json({ saved: false });
  }
});

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Health check endpoint (moved to /api/health for consistency)
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date() });
});

// Root endpoint for basic check
app.get('/', (req, res) => {
  res.send('FITZ ESEALS Backend is running.');
});

// Authentication Routes
app.post('/api/auth/signup', async (req, res) => {
  try {
    // accept additional profile fields as well
    const { email, password, full_name, phone, company, address } = req.body;

    let userId = null;

    // If service role key is available, create user using admin API to obtain user id immediately
    try {
      const { data: adminData, error: adminError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

      if (adminError) {
        // fall back to normal signUp
        throw adminError;
      }

      userId = adminData.user.id;
    } catch (adminErr) {
      // Fallback: use regular signUp (may require email confirmation before user exists)
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      });

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      // If signUp returned a user object, capture id
      userId = data && data.user ? data.user.id : null;
    }

    // Create user profile record. If userId is not yet available (email confirmation required), insert with email and update later via webhook/cron.
    const profile = {
      full_name,
      email,
      phone: phone || null,
      company: company || null,
      address: address || null,
      created_at: new Date(),
    };

    if (userId) profile.id = userId;

    const { error: insertError } = await supabase.from('users').insert([profile]);

    if (insertError) {
      return res.status(400).json({ error: insertError.message });
    }

    res.json({ message: 'User created successfully', user_id: userId, email });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ message: 'Login successful', user: data.user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Seal Management Routes
// Register a new seal with custom UUID (token)
app.post('/api/seals', async (req, res) => {
  try {
    const { user_id, seal_number, truck_number, rfid_code } = req.body;

    const { data, error } = await supabase.from('seals').insert([
      {
        user_id,
        seal_number,
        truck_number,
        rfid_code,
        status: 'registered',
        created_at: new Date(),
      },
    ]);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ message: 'Seal registered successfully', seal: data[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Edit seal (name, truck number)
app.put('/api/seals/:sealId', async (req, res) => {
  try {
    const { sealId } = req.params;
    const { seal_number, truck_number } = req.body;
    const { data, error } = await supabase.from('seals').update({
      seal_number,
      truck_number,
      updated_at: new Date(),
    }).eq('id', sealId).select();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: 'Seal updated', seal: data[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete seal
app.delete('/api/seals/:sealId', async (req, res) => {
  try {
    const { sealId } = req.params;
    const { error } = await supabase.from('seals').delete().eq('id', sealId);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: 'Seal deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/seals/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const { data, error } = await supabase
      .from('seals')
      .select('*')
      .eq('user_id', userId);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ seals: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/seals/detail/:sealId', async (req, res) => {
  try {
    const { sealId } = req.params;

    const { data, error } = await supabase
      .from('seals')
      .select('*')
      .eq('id', sealId)
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ seal: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Location Routes (GPS Data from ESP32)
app.post('/api/locations', async (req, res) => {
  try {
    const { seal_id, accuracy, altitude } = req.body;
    // Accept both lat/lon and latitude/longitude
    let latitude = req.body.latitude;
    let longitude = req.body.longitude;
    if (latitude === undefined && req.body.lat !== undefined) latitude = req.body.lat;
    if (longitude === undefined && req.body.lon !== undefined) longitude = req.body.lon;

    const { data, error } = await supabase.from('locations').insert([
      {
        seal_id,
        latitude,
        longitude,
        accuracy,
        altitude,
        created_at: new Date(),
      },
    ]);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    // Update seal's last location and updated_at
    await supabase
      .from('seals')
      .update({ updated_at: new Date() })
      .eq('id', seal_id);

    res.json({ message: 'Location recorded', location: data[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/locations/:sealId', async (req, res) => {
  try {
    const { sealId } = req.params;

    const { data, error } = await supabase
      .from('locations')
      .select('*')
      .eq('seal_id', sealId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ locations: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Seal Events Routes
app.post('/api/seal-events', async (req, res) => {
  try {
    const { seal_id, event_type, description } = req.body;

    const { data, error } = await supabase.from('seal_events').insert([
      {
        seal_id,
        event_type,
        description,
        created_at: new Date(),
      },
    ]);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ message: 'Event recorded', event: data[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/seal-events/:sealId', async (req, res) => {
  try {
    const { sealId } = req.params;

    const { data, error } = await supabase
      .from('seal_events')
      .select('*')
      .eq('seal_id', sealId)
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ events: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Seal Lock/Unlock Routes
app.post('/api/seals/:sealId/lock', async (req, res) => {
  try {
    const { sealId } = req.params;
    const { rfid_code } = req.body;

    // Verify RFID code
    const { data: seal, error: sealError } = await supabase
      .from('seals')
      .select('*')
      .eq('id', sealId)
      .single();

    if (sealError || !seal) {
      return res.status(404).json({ error: 'Seal not found' });
    }

    if (seal.rfid_code !== rfid_code) {
      return res.status(400).json({ error: 'Invalid RFID code' });
    }

    // Update seal status
    const { error: updateError } = await supabase
      .from('seals')
      .update({
        status: 'locked',
        locked_at: new Date(),
        updated_at: new Date(),
      })
      .eq('id', sealId);

    if (updateError) {
      return res.status(400).json({ error: updateError.message });
    }

    // Record event
    await supabase.from('seal_events').insert([
      {
        seal_id: sealId,
        event_type: 'LOCK',
        description: 'Seal locked via RFID',
        created_at: new Date(),
      },
    ]);

    res.json({ message: 'Seal locked successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/seals/:sealId/unlock', async (req, res) => {
  try {
    const { sealId } = req.params;
    const { otp } = req.body;

    // Verify OTP
    const { data: otpData, error: otpError } = await supabase
      .from('otp_codes')
      .select('*')
      .eq('seal_id', sealId)
      .eq('code', otp)
      .eq('is_used', false)
      .single();

    if (otpError || !otpData) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    // Mark OTP as used
    await supabase
      .from('otp_codes')
      .update({ is_used: true })
      .eq('id', otpData.id);

    // Update seal status
    const { error: updateError } = await supabase
      .from('seals')
      .update({
        status: 'unlocked',
        unlocked_at: new Date(),
        updated_at: new Date(),
      })
      .eq('id', sealId);

    if (updateError) {
      return res.status(400).json({ error: updateError.message });
    }

    // Record event
    await supabase.from('seal_events').insert([
      {
        seal_id: sealId,
        event_type: 'UNLOCK',
        description: 'Seal unlocked via OTP',
        created_at: new Date(),
      },
    ]);

    res.json({ message: 'Seal unlocked successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// OTP Routes
app.post('/api/otp/generate', async (req, res) => {
  try {
    const { seal_id } = req.body;

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    const { data, error } = await supabase.from('otp_codes').insert([
      {
        seal_id,
        code: otp,
        is_used: false,
        created_at: new Date(),
      },
    ]);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ message: 'OTP generated', otp });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/otp/verify', async (req, res) => {
  try {
    const { seal_id, otp } = req.body;

    const { data, error } = await supabase
      .from('otp_codes')
      .select('*')
      .eq('seal_id', seal_id)
      .eq('code', otp)
      .eq('is_used', false)
      .single();

    if (error || !data) {
      return res.status(400).json({ error: 'Invalid OTP' });
    }

    // Mark as used
    await supabase
      .from('otp_codes')
      .update({ is_used: true })
      .eq('id', data.id);

    res.json({ message: 'OTP verified successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Tampering Alerts
app.post('/api/tampering-alerts', async (req, res) => {
  try {
    const { seal_id, latitude, longitude } = req.body;

    // Update seal status
    await supabase
      .from('seals')
      .update({
        status: 'tampered',
        updated_at: new Date(),
      })
      .eq('id', seal_id);

    // Record tampering event
    const { data, error } = await supabase
      .from('seal_events')
      .insert([
        {
          seal_id,
          event_type: 'TAMPERING_DETECTED',
          description: `Tampering detected at ${latitude}, ${longitude}`,
          created_at: new Date(),
        },
      ]);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    // TODO: Send notification to user

    res.json({ message: 'Tampering alert recorded' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Supabase webhook to handle auth events (e.g., user.confirmed) and update profile id
app.post('/webhook/supabase-auth', async (req, res) => {
  try {
    const event = req.body; // Supabase sends a JSON payload describing the event

    // We expect event.type and event.record (or similar structure depending on Supabase)
    // Example: { "type": "user.created", "user": { id, email } }

    // Handle user.confirmed or user.created events to ensure profile row contains id
    const eventType = event.type || event.event || (event.record && event.record.type);

    if (eventType && (eventType.includes('user.created') || eventType.includes('user.confirmed') || eventType.includes('auth')) ) {
      const user = event.user || event.record || event;
      const userId = (user && user.id) || (user && user.user && user.user.id);
      const email = (user && user.email) || (user && user.user && user.user.email);

      if (userId && email) {
        // Update existing profile row that matches email, set id if missing
        const { data, error } = await supabase
          .from('users')
          .update({ id: userId })
          .eq('email', email)
          .is('id', null);

        if (error) {
          console.error('Webhook: failed to update profile id', error.message);
          return res.status(500).json({ error: error.message });
        }

        return res.json({ message: 'Profile updated', userId, email });
      }
    }

    res.json({ message: 'Event ignored' });
  } catch (err) {
    console.error('Webhook error', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/tampering-alerts/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const { data: seals, error: sealsError } = await supabase
      .from('seals')
      .select('id')
      .eq('user_id', userId);

    if (sealsError) {
      return res.status(400).json({ error: sealsError.message });
    }

    const sealIds = seals.map(s => s.id);

    const { data: events, error: eventsError } = await supabase
      .from('seal_events')
      .select('*')
      .in('seal_id', sealIds)
      .eq('event_type', 'TAMPERING_DETECTED')
      .order('created_at', { ascending: false });

    if (eventsError) {
      return res.status(400).json({ error: eventsError.message });
    }

    res.json({ alerts: events });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`FITZ ESEALS Backend running on port ${PORT}`);
});

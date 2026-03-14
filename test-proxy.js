const axios = require('axios');

// Replace with your backend and Render URLs
const backendUrl = 'https://fitz-eseals.onrender.com/proxy';


const endpoints = [
  {
    name: 'User Login',
    url: 'https://fitz-eseals.onrender.com/api/esp32/user-login',
    body: { device_id: 'test-device-001', user_id: 'test-user-001' }
  },
  {
    name: 'First Scan',
    url: 'https://fitz-eseals.onrender.com/api/esp32/first-scan',
    body: { device_id: 'test-device-001', user_id: 'test-user-001', rfid_code: 'rfid123', access_token: 'token123' }
  },
  {
    name: 'Save Seal Details',
    url: 'https://fitz-eseals.onrender.com/api/esp32/save-seal-details',
    body: { device_id: 'test-device-001', rfid_code: 'rfid123', seal_number: 'seal001', truck_number: 'truck001' }
  },
  {
    name: 'Tamper Detection',
    url: 'https://fitz-eseals.onrender.com/api/seal-events',
    body: {
      seal_id: 'eee56fe6-acf4-4316-a170-385a559cfba4',
      event_type: 'TAMPERING_DETECTED',
      description: 'Seal tampering detected for SEAL-001 on truck TRK-12345.'
    }
  },
  {
    name: 'Seal Location Tracking',
    url: 'https://fitz-eseals.onrender.com/api/locations',
    body: {
      seal_id: 'eee56fe6-acf4-4316-a170-385a559cfba4',
      latitude: 12.3456,
      longitude: 78.9012,
      accuracy: 5.0,
      altitude: 100.0,
      timestamp: '2026-03-14T15:45:00Z'
    }
  }
];

async function testAllEndpoints() {
  for (const ep of endpoints) {
    try {
      const response = await axios.post(backendUrl, {
        targetUrl: ep.url,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: ep.body
      });
      console.log(`Proxy Response for ${ep.name}:`, response.data);
    } catch (error) {
      console.error(`Proxy Error for ${ep.name}:`, {
        message: error.message,
        code: error.code,
        stack: error.stack,
        response: error.response ? {
          status: error.response.status,
          data: error.response.data,
          headers: error.response.headers
        } : undefined,
        config: error.config
      });
    }
  }
}

testAllEndpoints();

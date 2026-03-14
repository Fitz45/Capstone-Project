const axios = require('axios');

// Replace with your backend and Render URLs
const backendUrl = 'http://localhost:3000/proxy';
const renderUrl = 'https://your-render-url.com/api/test';

async function testProxy() {
  try {
    const response = await axios.post(backendUrl, {
      targetUrl: renderUrl,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { message: 'Hello from ESP32/SIM800L' }
    });
    console.log('Proxy Response:', response.data);
  } catch (error) {
    console.error('Proxy Error:', error.response ? error.response.data : error.message);
  }
}

testProxy();

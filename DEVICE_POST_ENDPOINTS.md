# ESP32/Device POST Endpoint Formats for FITZ ESEALS

## 1. User Login
POST https://fitz-eseals.onrender.com/api/esp32/user-login
Body:
{
  "device_id": "<device_id>",
  "user_id": "<user_id>"
}

## 2. First Scan
POST https://fitz-eseals.onrender.com/api/esp32/first-scan
Body:
{
  "device_id": "<device_id>",
  "user_id": "<user_id>",
  "rfid_code": "<rfid_code>",
  "access_token": "<access_token>"
}

## 3. Save Seal Details
POST https://fitz-eseals.onrender.com/api/esp32/save-seal-details
Body:
{
  "device_id": "<device_id>",
  "rfid_code": "<rfid_code>",
  "seal_number": "<seal_number>",
  "truck_number": "<truck_number>"
}


## 4. Tamper Detection
POST https://fitz-eseals.onrender.com/api/seal-events
Body:
{
  "seal_id": "<seal_id>",
  "event_type": "TAMPERING_DETECTED",
  "description": "<description>"
}

## 5. Seal Location Tracking
POST https://fitz-eseals.onrender.com/api/locations
Body:
{
  "seal_id": "<seal_id>",
  "latitude": <latitude>,
  "longitude": <longitude>,
  "timestamp": "<timestamp>"
}

## Usage
- Use the proxy endpoint to forward requests from ESP32/SIM800L to these URLs.
- Ensure payloads match the required format for each endpoint.
- Responses will confirm registration, event, or location actions.

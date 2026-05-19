import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

async function run() {
  const projectId = process.env.BBC_PROJECT_ID || '83457ab6-a0df-4b07-b91f-e0fa8d19d45f';
  const apiKey = process.env.BBC_API_KEY || 'bbc-1a982c21-ecbe-4d40-a541-4a27aeaf58af';
  const baseUrl = 'https://app.builderbot.cloud';

  // Try to get bot status / project info
  const url = `${baseUrl}/api/v2/${projectId}`;
  console.log('Checking project status at:', url);
  
  try {
    const r = await axios.get(url, {
      headers: { 'x-api-builderbot': apiKey },
      timeout: 15000,
    });
    console.log('✅ Status:', r.status);
    console.log('Response:', JSON.stringify(r.data, null, 2));
  } catch (err: any) {
    if (err.response) {
      console.log('❌ Status:', err.response.status);
      console.log('Data:', JSON.stringify(err.response.data, null, 2));
    } else {
      console.log('❌ No response:', err.message);
    }
  }
  process.exit(0);
}
run();

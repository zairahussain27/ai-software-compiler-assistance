require('dotenv').config();

async function test() {
  const response = await fetch(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        
        messages: [
          {
            role: 'user',
            content: 'Say only: Groq is working'
          }
        ]
      })
    }
  );

  const data = await response.json();

  console.log('Status:', response.status);
  console.log(JSON.stringify(data, null, 2));
}

test().catch(console.error);
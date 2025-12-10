import { Request, Response } from 'express';
import axios from 'axios';

export const chatWithAI = async (req: Request, res: Response): Promise<void> => {
  try {
    const { message } = req.body;
    const apiKey = process.env.GEMINI_API_KEY; // Ini isinya Key Groq

    if (!message) {
      res.status(400).json({ error: 'Message is required' });
      return;
    }

    // URL API Groq
    const url = 'https://api.groq.com/openai/v1/chat/completions';

    const payload = {
      model: "llama-3.3-70b-versatile", 
      messages: [
        {
          role: "system",
          content: "Kamu adalah asisten CRM profesional. Jawablah pertanyaan ini dengan singkat, padat, dan sopan dalam Bahasa Inggris."
        },
        {
          role: "user",
          content: message
        }
      ],
      temperature: 0.7
    };

    const response = await axios.post(url, payload, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      }
    });

    const text = response.data?.choices?.[0]?.message?.content;

    if (!text) {
        throw new Error("No response text from AI");
    }

    res.status(200).json({ reply: text });

  } catch (error: any) {
    console.error('AI Chat Error:', error.response?.data || error.message);
    res.status(500).json({ error: 'AI sedang sibuk, coba lagi nanti.' });
  }
};
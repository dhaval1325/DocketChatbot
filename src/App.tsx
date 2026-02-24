/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from "@google/genai";
import { 
  Send, 
  Upload, 
  FileText, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  User, 
  Bot,
  RefreshCw,
  Search
} from 'lucide-react';
import Markdown from 'react-markdown';
import { motion, AnimatePresence } from 'motion/react';

// Initialize Gemini
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  image?: string;
  status?: 'loading' | 'success' | 'error';
};

type Docket = {
  id: string;
  customer_name: string;
  delivery_address: string;
  status: string;
  pod_verified: number;
  updated_at: string;
};

export default function App() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: "Hello! I'm your POD Verification Assistant. Please provide a **Docket Number** to get started, or upload a **POD image** directly if you have one ready."
    }
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [currentDocket, setCurrentDocket] = useState<Docket | null>(null);
  const [pendingPodImage, setPendingPodImage] = useState<string | null>(null);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  const addMessage = (msg: Omit<Message, 'id'>) => {
    const newMsg = { ...msg, id: Math.random().toString(36).substring(7) };
    setMessages(prev => [...prev, newMsg]);
    return newMsg.id;
  };

  const updateMessageStatus = (id: string, status: Message['status'], content?: string) => {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, status, content: content ?? m.content } : m));
  };

  const fetchDocket = async (id: string) => {
    try {
      const res = await fetch(`/api/dockets/${id}`);
      if (res.ok) {
        const data = await res.json();
        setCurrentDocket(data);
        return data;
      }
      return null;
    } catch (err) {
      console.error(err);
      return null;
    }
  };

  const updateDocketStatus = async (id: string, status: string, verified: boolean) => {
    try {
      const res = await fetch(`/api/dockets/${id}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, pod_verified: verified })
      });
      return res.ok;
    } catch (err) {
      console.error(err);
      return false;
    }
  };

  const analyzePOD = async (base64Image: string, docket: Docket) => {
    setIsTyping(true);
    const msgId = addMessage({ 
      role: 'assistant', 
      content: 'Analyzing POD image against docket details...', 
      status: 'loading' 
    });

    try {
      const model = "gemini-3-flash-preview";
      const prompt = `
        You are a logistics assistant verifying a Proof of Delivery (POD) document.
        
        DOCKET DETAILS:
        - ID: ${docket.id}
        - Customer: ${docket.customer_name}
        - Address: ${docket.delivery_address}
        
        TASK:
        1. Check if the image is a valid POD (Proof of Delivery).
        2. Verify if the Docket ID or Customer Name is visible and matches.
        3. Check for a signature or stamp indicating receipt.
        4. Determine if this POD is "GOOD" (valid) or "BAD" (invalid/missing info).
        
        Respond in a friendly tone. If it is good, explicitly say "This POD is good". 
        Summarize what you found (e.g., "Signature found", "Address matches").
      `;

      const result = await genAI.models.generateContent({
        model,
        contents: {
          parts: [
            { text: prompt },
            { inlineData: { mimeType: "image/jpeg", data: base64Image.split(',')[1] } }
          ]
        }
      });

      const responseText = result.text || "I couldn't analyze the image properly.";
      updateMessageStatus(msgId, 'success', responseText);
      
      if (responseText.toLowerCase().includes("pod is good")) {
        setPendingPodImage(base64Image);
      }

    } catch (error) {
      console.error(error);
      updateMessageStatus(msgId, 'error', "Sorry, I encountered an error while analyzing the POD. Please try again.");
    } finally {
      setIsTyping(false);
    }
  };

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim()) return;

    const userMsg = input.trim();
    setInput('');
    addMessage({ role: 'user', content: userMsg });

    // Logic for "update"
    if (userMsg.toLowerCase().includes('update') || userMsg.toLowerCase().includes('please update')) {
      if (currentDocket && pendingPodImage) {
        setIsTyping(true);
        const success = await updateDocketStatus(currentDocket.id, 'Delivered', true);
        if (success) {
          addMessage({ 
            role: 'assistant', 
            content: `Successfully updated docket **${currentDocket.id}** status to **Delivered**. POD has been verified and recorded.` 
          });
          setPendingPodImage(null);
        } else {
          addMessage({ role: 'assistant', content: "Failed to update the docket. Please try again." });
        }
        setIsTyping(false);
      } else if (!currentDocket) {
        addMessage({ role: 'assistant', content: "Please provide a docket number first." });
      } else {
        addMessage({ role: 'assistant', content: "I haven't verified a POD for this docket yet. Please upload the POD image first." });
      }
      return;
    }

    // Logic for Docket Search
    const docketMatch = userMsg.match(/DKT-\d+/i);
    if (docketMatch) {
      setIsTyping(true);
      const docketId = docketMatch[0].toUpperCase();
      const docket = await fetchDocket(docketId);
      if (docket) {
        addMessage({ 
          role: 'assistant', 
          content: `Found Docket: **${docket.id}**\n\n**Customer:** ${docket.customer_name}\n**Address:** ${docket.delivery_address}\n**Status:** ${docket.status}\n\nPlease upload the POD image for verification.` 
        });
      } else {
        addMessage({ role: 'assistant', content: `Sorry, I couldn't find docket **${docketId}**. Try DKT-1001, DKT-1002, or DKT-1003.` });
      }
      setIsTyping(false);
      return;
    }

    // Default AI response for other queries
    setIsTyping(true);
    try {
      const result = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: userMsg,
        config: {
          systemInstruction: "You are a helpful logistics assistant. You help users verify PODs against dockets. If they give you a docket number like DKT-1001, tell them you can search for it. If they ask to update, tell them they need to upload a verified POD first."
        }
      });
      addMessage({ role: 'assistant', content: result.text || "I'm not sure how to help with that." });
    } catch (err) {
      addMessage({ role: 'assistant', content: "I'm having trouble connecting right now." });
    } finally {
      setIsTyping(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!currentDocket) {
      addMessage({ role: 'assistant', content: "Please search for a docket (e.g., DKT-1001) before uploading the POD." });
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      addMessage({ role: 'user', content: "Uploaded POD image", image: base64 });
      analyzePOD(base64, currentDocket);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex flex-col h-screen bg-[#F8F9FA] font-sans text-slate-900">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 p-2 rounded-lg">
            <Bot className="text-white w-6 h-6" />
          </div>
          <div>
            <h1 className="font-bold text-lg tracking-tight">POD Verifier</h1>
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Logistics AI Assistant</p>
          </div>
        </div>
        {currentDocket && (
          <div className="hidden sm:flex items-center gap-4 bg-slate-50 px-4 py-2 rounded-full border border-slate-200">
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-400 font-bold uppercase">Active Docket</span>
              <span className="text-sm font-bold text-indigo-600">{currentDocket.id}</span>
            </div>
            <button 
              onClick={() => setCurrentDocket(null)}
              className="text-slate-400 hover:text-slate-600 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        )}
      </header>

      {/* Chat Area */}
      <main 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 scroll-smooth"
      >
        <div className="max-w-3xl mx-auto space-y-6">
          <AnimatePresence initial={false}>
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
              >
                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 shadow-sm ${
                  msg.role === 'user' ? 'bg-indigo-100 text-indigo-600' : 'bg-white text-slate-600 border border-slate-200'
                }`}>
                  {msg.role === 'user' ? <User className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
                </div>
                
                <div className={`flex flex-col max-w-[80%] ${msg.role === 'user' ? 'items-end' : ''}`}>
                  <div className={`rounded-2xl px-5 py-3 shadow-sm ${
                    msg.role === 'user' 
                      ? 'bg-indigo-600 text-white rounded-tr-none' 
                      : 'bg-white border border-slate-200 rounded-tl-none'
                  }`}>
                    {msg.image && (
                      <img 
                        src={msg.image} 
                        alt="POD" 
                        className="rounded-lg mb-3 max-h-64 object-cover border border-slate-100" 
                        referrerPolicy="no-referrer"
                      />
                    )}
                    <div className="prose prose-slate prose-sm max-w-none">
                      <Markdown>{msg.content}</Markdown>
                    </div>
                    
                    {msg.status === 'loading' && (
                      <div className="flex items-center gap-2 mt-2 text-indigo-400">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-xs font-medium italic">AI is thinking...</span>
                      </div>
                    )}
                  </div>
                  
                  {msg.status === 'success' && (
                    <div className="flex items-center gap-1 mt-1 text-[10px] font-bold text-emerald-600 uppercase tracking-widest">
                      <CheckCircle2 className="w-3 h-3" /> Verified by AI
                    </div>
                  )}
                  {msg.status === 'error' && (
                    <div className="flex items-center gap-1 mt-1 text-[10px] font-bold text-rose-600 uppercase tracking-widest">
                      <AlertCircle className="w-3 h-3" /> Analysis Failed
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          
          {isTyping && !messages.some(m => m.status === 'loading') && (
            <div className="flex gap-4">
              <div className="w-10 h-10 rounded-full bg-white border border-slate-200 flex items-center justify-center shrink-0 shadow-sm">
                <Bot className="w-5 h-5 text-slate-600" />
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-none px-5 py-3 shadow-sm flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Input Area */}
      <footer className="bg-white border-t border-slate-200 p-4 md:p-6">
        <div className="max-w-3xl mx-auto">
          <div className="flex flex-wrap gap-2 mb-4">
            {!currentDocket ? (
              ['DKT-1001', 'DKT-1002', 'DKT-1003'].map(id => (
                <button
                  key={id}
                  onClick={() => { setInput(id); handleSend(); }}
                  className="text-xs font-bold px-3 py-1.5 rounded-full bg-slate-100 text-slate-600 hover:bg-indigo-50 hover:text-indigo-600 border border-slate-200 transition-all flex items-center gap-1.5"
                >
                  <Search className="w-3 h-3" /> {id}
                </button>
              ))
            ) : (
              <>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="text-xs font-bold px-3 py-1.5 rounded-full bg-indigo-50 text-indigo-600 hover:bg-indigo-100 border border-indigo-200 transition-all flex items-center gap-1.5"
                >
                  <Upload className="w-3 h-3" /> Upload POD
                </button>
                {pendingPodImage && (
                  <button
                    onClick={() => { setInput("Please update"); handleSend(); }}
                    className="text-xs font-bold px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border border-emerald-200 transition-all flex items-center gap-1.5"
                  >
                    <CheckCircle2 className="w-3 h-3" /> Confirm Update
                  </button>
                )}
              </>
            )}
          </div>

          <form onSubmit={handleSend} className="relative flex items-center gap-2">
            <input 
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept="image/*"
              className="hidden"
            />
            <div className="relative flex-1">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={currentDocket ? "Type 'please update' or upload POD..." : "Enter Docket Number (e.g. DKT-1001)..."}
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 pr-12 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-sm shadow-inner"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-indigo-600 transition-colors"
                title="Upload POD"
              >
                <Upload className="w-5 h-5" />
              </button>
            </div>
            <button
              type="submit"
              disabled={!input.trim() || isTyping}
              className="bg-indigo-600 text-white p-4 rounded-2xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-indigo-200"
            >
              <Send className="w-5 h-5" />
            </button>
          </form>
          <p className="text-[10px] text-center text-slate-400 mt-3 font-medium uppercase tracking-widest">
            AI-Powered POD Verification System
          </p>
        </div>
      </footer>
    </div>
  );
}

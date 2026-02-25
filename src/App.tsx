import { Mic, MicOff, MessageCircle, Info, X, AlertCircle, ArrowRight, Heart, LogOut, User as UserIcon, Mail, Lock } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useLiveSession } from './hooks/useLiveSession';
import { VoiceVisualizer } from './components/VoiceVisualizer';
import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { auth, googleProvider } from './lib/firebase';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, User, signInWithPopup } from 'firebase/auth';
import { Helmet } from 'react-helmet-async';

export default function App() {
  const { isConnected, isConnecting, transcript, turnCount, error: sessionError, connect, disconnect } = useLiveSession();
  const [showTranscript, setShowTranscript] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [showAuthPage, setShowAuthPage] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isPremium, setIsPremium] = useState(false);
  const [hasUsedTrial, setHasUsedTrial] = useState(false);
  const [isInitializingPayment, setIsInitializingPayment] = useState(false);
  const [showPremiumModal, setShowPremiumModal] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  
  // Auth Form State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
      if (currentUser) {
        checkSubscription(currentUser.uid);
      }
    });

    // Check for payment feedback in URL
    const params = new URLSearchParams(window.location.search);
    if (params.get('payment_success') === 'true') {
      setPaymentStatus({ type: 'success', message: 'Payment successful! Your premium access is now active.' });
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (params.get('payment_error')) {
      const error = params.get('payment_error');
      let message = 'Payment verification failed. Please contact support.';
      if (error === 'missing_data') message = 'Payment data missing. Please try again.';
      if (error === 'verification_failed') message = 'Paystack could not verify this transaction.';
      setPaymentStatus({ type: 'error', message });
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    return () => unsubscribe();
  }, []);

  const checkSubscription = async (userId: string) => {
    try {
      const res = await fetch(`/api/subscription/status/${userId}`);
      const data = await res.json();
      setIsPremium(data.isPremium);
      setHasUsedTrial(data.hasUsedTrial);
    } catch (err) {
      console.error("Failed to check subscription", err);
    }
  };

  const useTrial = async () => {
    if (!user) return;
    try {
      await fetch('/api/subscription/use-trial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid })
      });
      setHasUsedTrial(true);
    } catch (err) {
      console.error("Failed to use trial", err);
    }
  };

  const handleStartConversation = async () => {
    if (isPremium) {
      connect();
      return;
    }

    if (hasUsedTrial) {
      setShowPremiumModal(true);
      return;
    }

    // Use trial and connect
    await useTrial();
    connect();
  };

  const handlePaystackClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!user || !user.email) return;

    setIsInitializingPayment(true);
    try {
      // Set cookie as backup for callback
      document.cookie = `pending_payment_user_id=${user.uid}; path=/; max-age=3600; SameSite=None; Secure`;

      const res = await fetch('/api/payment/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.uid, email: user.email })
      });
      const data = await res.json();
      
      if (data.authorization_url) {
        window.location.href = data.authorization_url;
      } else {
        throw new Error("Failed to get checkout URL");
      }
    } catch (err) {
      console.error("Payment initialization failed", err);
      setPaymentStatus({ type: 'error', message: 'Failed to start payment process. Please try again.' });
    } finally {
      setIsInitializingPayment(false);
    }
  };

  useEffect(() => {
    // We no longer limit by turn count, but by session start
    // However, we can still keep this as a fallback or remove it
    // The user said "once start conversation starts they have used their free trail"
  }, [turnCount, isPremium, isConnected, disconnect]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setIsSubmitting(true);

    try {
      if (isSignUp) {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err: any) {
      console.error("Auth failed", err);
      if (isSignUp) {
        if (err.code === 'auth/email-already-in-use') {
          setAuthError("User already exists. Please sign in");
        } else {
          setAuthError(err.message);
        }
      } else {
        if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
          setAuthError("Email or password is incorrect");
        } else {
          setAuthError(err.message);
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleLogin = async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      console.error("Google login failed", err);
      setAuthError(err.message);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setHasStarted(false);
    } catch (err) {
      console.error("Logout failed", err);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#fdfcf9] flex items-center justify-center">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full"
        />
      </div>
    );
  }

  if (!user || !hasStarted) {
    return (
      <div className="min-h-screen bg-[#fdfcf9] text-zinc-800 font-sans selection:bg-emerald-100 flex flex-col items-center justify-center p-6 overflow-hidden">
        <Helmet>
          <title>Healing with MMA | AI-Powered Emotional Support</title>
          <meta name="description" content="A gentle, voice-first space for reflection, support, and emotional well-being. Powered by Mine ai." />
        </Helmet>
        {/* Background Atmosphere */}
        <div className="fixed inset-0 pointer-events-none">
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-emerald-100/40 rounded-full blur-[120px]" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-amber-50/60 rounded-full blur-[120px]" />
        </div>

        <motion.div 
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative z-10 max-w-2xl w-full text-center space-y-12"
        >
          <div className="space-y-4">
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-emerald-600 text-white shadow-2xl shadow-emerald-200 mb-4"
            >
              <Heart size={40} fill="currentColor" />
            </motion.div>
            <div className="space-y-2">
              <h1 className="text-6xl md:text-7xl font-serif italic font-light tracking-tight text-zinc-900">
                Healing with MMA
              </h1>
              <motion.p 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="text-emerald-600 font-medium tracking-[0.3em] text-xs uppercase"
              >
                Powered by Mine ai
              </motion.p>
            </div>
            <p className="text-zinc-500 text-lg md:text-xl max-w-lg mx-auto leading-relaxed">
              A gentle, voice-first space for reflection, support, and emotional well-being.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6 text-left">
            {[
              { title: "Voice First", desc: "Natural, real-time conversation that feels human." },
              { title: "Safe Space", desc: "Non-judgmental support available whenever you need it." },
              { title: "Private", desc: "Your reflections are yours alone. No data is stored." }
            ].map((feature, i) => (
              <motion.div 
                key={i}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 + (i * 0.1) }}
                className="p-6 rounded-2xl bg-white/50 backdrop-blur-sm border border-zinc-100 shadow-sm"
              >
                <h3 className="font-serif font-medium text-lg mb-2">{feature.title}</h3>
                <p className="text-zinc-500 text-sm leading-relaxed">{feature.desc}</p>
              </motion.div>
            ))}
          </div>

          {/* Founder Section */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7 }}
            className="flex flex-col md:flex-row items-center gap-8 p-8 rounded-3xl bg-white/40 backdrop-blur-md border border-zinc-100 shadow-sm text-left"
          >
            <div className="w-32 h-32 md:w-40 md:h-40 rounded-2xl overflow-hidden flex-shrink-0 shadow-lg border-2 border-white">
              <img 
                src="https://image2url.com/r2/default/images/1772011684933-2feb7ab1-8810-4626-aa12-93088a05b80c.jpg" 
                alt="Chidimma Okoye" 
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            </div>
            <div className="space-y-3">
              <h3 className="text-xl font-serif font-medium text-zinc-900">Meet the Founder</h3>
              <p className="text-zinc-600 text-sm leading-relaxed italic">
                "Healing with MMA was born from a vision to combine the strength of mindfulness and the accessibility of AI to provide a sanctuary for everyone seeking emotional balance."
              </p>
              <p className="text-emerald-700 font-serif font-medium text-sm">— Chidimma Okoye, Founder</p>
            </div>
          </motion.div>

          {user ? (
            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.8 }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setHasStarted(true)}
              className="group flex items-center gap-3 px-10 py-5 bg-zinc-900 text-white rounded-full font-medium text-lg shadow-2xl hover:bg-zinc-800 transition-all mx-auto"
            >
              Enter the Space
              <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
            </motion.button>
          ) : showAuthPage ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="max-w-md mx-auto w-full bg-white p-8 rounded-3xl shadow-2xl border border-zinc-100 relative"
            >
              <button 
                onClick={() => setShowAuthPage(false)}
                className="absolute top-6 right-6 p-2 hover:bg-zinc-100 rounded-full transition-colors text-zinc-400"
              >
                <X size={20} />
              </button>

              <h2 className="text-2xl font-serif font-medium mb-6">
                {isSignUp ? 'Create an Account' : 'Welcome Back'}
              </h2>
              
              <div className="space-y-4">
                <button
                  onClick={handleGoogleLogin}
                  className="w-full flex items-center justify-center gap-3 py-3 bg-white border border-zinc-200 rounded-xl font-medium text-zinc-700 hover:bg-zinc-50 transition-all shadow-sm"
                >
                  <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5" />
                  Continue with Google
                </button>

                <div className="relative py-4">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-zinc-100"></div>
                  </div>
                  <div className="relative flex justify-center text-xs uppercase tracking-widest">
                    <span className="bg-white px-4 text-zinc-400">Or with email</span>
                  </div>
                </div>

                <form onSubmit={handleAuth} className="space-y-4">
                  <div className="relative">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
                    <input
                      type="email"
                      placeholder="Email Address"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full pl-12 pr-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                    />
                  </div>
                  
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
                    <input
                      type="password"
                      placeholder="Password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full pl-12 pr-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                    />
                  </div>

                  {authError && (
                    <div className="text-red-500 text-sm flex items-center gap-2 px-1">
                      <AlertCircle size={14} />
                      {authError}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full py-3 bg-emerald-600 text-white rounded-xl font-medium shadow-lg shadow-emerald-200 hover:bg-emerald-700 transition-all disabled:opacity-50"
                  >
                    {isSubmitting ? 'Processing...' : (isSignUp ? 'Sign Up' : 'Sign In')}
                  </button>
                </form>

                <div className="mt-6 text-center">
                  <button
                    onClick={() => {
                      setIsSignUp(!isSignUp);
                      setAuthError(null);
                    }}
                    className="text-sm text-zinc-500 hover:text-emerald-600 transition-colors"
                  >
                    {isSignUp ? 'Already have an account? Sign In' : "Don't have an account? Sign Up"}
                  </button>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.8 }}
              className="flex flex-col items-center gap-6"
            >
              <div className="flex flex-col sm:flex-row items-center gap-4">
                <button
                  onClick={() => setShowAuthPage(true)}
                  className="group flex items-center gap-3 px-10 py-5 bg-zinc-900 text-white rounded-full font-medium text-lg shadow-2xl hover:bg-zinc-800 transition-all"
                >
                  Sign In to Start
                  <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
                </button>
                
                <a
                  href="https://mine-ai-2-0.vercel.app/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center gap-3 px-10 py-5 bg-white text-emerald-700 border-2 border-emerald-100 rounded-full font-medium text-lg shadow-xl hover:bg-emerald-50 hover:border-emerald-200 transition-all"
                >
                  Try Mine ai
                  <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
                </a>
              </div>
              <p className="text-zinc-400 text-sm">
                Join our community for a personalized experience.
              </p>
            </motion.div>
          )}
        </motion.div>

        <footer className="fixed bottom-8 text-zinc-400 text-xs uppercase tracking-[0.2em] font-medium">
          Guided by Compassion • Powered by Mine ai
        </footer>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fdfcf9] text-zinc-800 font-sans selection:bg-emerald-100 overflow-hidden">
      <Helmet>
        <title>Counseling Session | Healing with MMA</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      {/* Background Atmosphere */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-emerald-100/40 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-amber-50/60 rounded-full blur-[120px]" />
      </div>

      <main className="relative z-10 max-w-4xl mx-auto min-h-screen flex flex-col px-6 py-12">
        {/* Header */}
        <header className="flex justify-between items-start mb-12">
          <button 
            onClick={() => setHasStarted(false)}
            className="group flex flex-col items-start"
          >
            <motion.h1 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-4xl font-serif italic font-light tracking-tight text-zinc-900 group-hover:text-emerald-700 transition-colors"
            >
              Healing with MMA
            </motion.h1>
            <div className="flex items-center gap-2">
              <motion.p 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="text-zinc-500 text-[10px] uppercase tracking-widest font-medium"
              >
                Counseling Session
              </motion.p>
              <span className="text-zinc-300 text-[10px]">•</span>
              {isPremium ? (
                <motion.span 
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="px-2 py-0.5 bg-amber-100 text-amber-700 text-[9px] font-bold uppercase tracking-tighter rounded-md border border-amber-200"
                >
                  Premium
                </motion.span>
              ) : (
                <div className="flex items-center gap-2">
                  <motion.span 
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="px-2 py-0.5 bg-zinc-100 text-zinc-600 text-[9px] font-bold uppercase tracking-tighter rounded-md border border-zinc-200"
                  >
                    Trial
                  </motion.span>
                  <motion.p 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15 }}
                    className="text-emerald-600 text-[10px] uppercase tracking-widest font-bold"
                  >
                    Powered by Mine ai
                  </motion.p>
                </div>
              )}
            </div>
          </button>
          
          <div className="flex gap-3 items-center">
            {user && (
              <div className="flex items-center gap-3 mr-2">
                <div className="text-right hidden sm:block">
                  <p className="text-xs font-bold text-zinc-900">{user.displayName}</p>
                  <p className="text-[10px] text-zinc-500">{user.email}</p>
                </div>
                {user.photoURL ? (
                  <img src={user.photoURL} alt={user.displayName || ''} className="w-10 h-10 rounded-full border border-zinc-200" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700">
                    <UserIcon size={20} />
                  </div>
                )}
                <button 
                  onClick={handleLogout}
                  className="p-3 rounded-full bg-white border border-zinc-200 shadow-sm hover:shadow-md transition-all text-red-500"
                  title="Logout"
                >
                  <LogOut size={20} />
                </button>
              </div>
            )}
            <button 
              onClick={() => setShowTranscript(!showTranscript)}
              className="p-3 rounded-full bg-white border border-zinc-200 shadow-sm hover:shadow-md transition-all text-zinc-600"
              title="View Transcript"
            >
              <MessageCircle size={20} />
            </button>
            <button className="p-3 rounded-full bg-white border border-zinc-200 shadow-sm hover:shadow-md transition-all text-zinc-600">
              <Info size={20} />
            </button>
            <button 
              onClick={() => setShowPremiumModal(true)}
              className="hidden sm:flex items-center gap-2 px-4 py-2 bg-amber-50 text-amber-700 rounded-full text-xs font-bold border border-amber-200 hover:bg-amber-100 transition-all"
            >
              <Heart size={14} fill="currentColor" />
              Subscription
            </button>
            <a 
              href="https://mine-ai-2-0.vercel.app/" 
              target="_blank" 
              rel="noopener noreferrer"
              className="hidden sm:flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-700 rounded-full text-xs font-bold border border-emerald-100 hover:bg-emerald-100 transition-all"
            >
              Try Mine ai
              <ArrowRight size={14} />
            </a>
          </div>
        </header>

        {/* Main Interaction Area */}
        <div className="flex-1 flex flex-col items-center justify-center">
          <VoiceVisualizer isActive={isConnected} isConnecting={isConnecting} />
          
          <div className="mt-12 text-center max-w-md">
            <AnimatePresence mode="wait">
              {!isConnected && !isConnecting ? (
                <motion.div
                  key="idle"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                  <h2 className="text-2xl font-serif font-medium text-zinc-800 mb-3">
                    Ready to listen.
                  </h2>
                  <p className="text-zinc-500 leading-relaxed">
                    Take a deep breath. When you're ready, tap the button below to start our conversation.
                  </p>
                </motion.div>
              ) : isConnecting ? (
                <motion.div
                  key="connecting"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                  <h2 className="text-2xl font-serif font-medium text-zinc-800 mb-3">
                    Connecting...
                  </h2>
                  <p className="text-zinc-500">
                    Preparing a safe space for you.
                  </p>
                </motion.div>
              ) : (
                <motion.div
                  key="active"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                  <h2 className="text-2xl font-serif font-medium text-zinc-800 mb-3">
                    I'm listening.
                  </h2>
                  <p className="text-zinc-500">
                    Speak freely. I'm here for you.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {sessionError && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="mt-6 p-4 bg-red-50 border border-red-100 rounded-2xl flex flex-col gap-2 text-red-600 text-sm max-w-md"
            >
              <div className="flex items-center gap-3">
                <AlertCircle size={18} />
                <span className="font-medium">{sessionError}</span>
              </div>
              {sessionError.includes("API Key") && (
                <p className="text-xs text-red-500 mt-1">
                  Please ensure you have set your <strong>GEMINI_API_KEY</strong> in the Secrets panel.
                </p>
              )}
            </motion.div>
          )}
        </div>

        {/* Controls */}
        <footer className="mt-12 flex flex-col items-center gap-6">
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={isConnected ? disconnect : handleStartConversation}
              disabled={isConnecting}
              className={`
                group relative flex items-center gap-4 px-8 py-4 rounded-full font-medium transition-all shadow-xl
                ${isConnected 
                  ? 'bg-zinc-900 text-white hover:bg-zinc-800' 
                  : 'bg-emerald-600 text-white hover:bg-emerald-700'}
                ${isConnecting ? 'opacity-50 cursor-not-allowed' : ''}
              `}
            >
              {isConnected ? (
                <>
                  <MicOff size={24} />
                  <span>End Session</span>
                </>
              ) : (
                <>
                  <Mic size={24} />
                  <span>Start Conversation</span>
                </>
              )}
              
              {!isConnected && (
                <div className="absolute inset-0 rounded-full bg-emerald-400/20 blur-xl group-hover:bg-emerald-400/30 transition-all pointer-events-none" />
              )}
            </motion.button>

            {!isPremium && !isConnected && (
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setShowPremiumModal(true)}
                className="flex items-center gap-3 px-8 py-4 bg-white text-amber-600 border-2 border-amber-100 rounded-full font-medium shadow-lg hover:bg-amber-50 transition-all"
              >
                <Heart size={20} fill="currentColor" />
                Upgrade to Premium
              </motion.button>
            )}
          </div>

          <p className="text-zinc-400 text-[10px] uppercase tracking-[0.2em] font-medium">
            Powered by Mine ai
          </p>
        </footer>
      </main>

      {/* Transcript Sidebar/Overlay */}
      <AnimatePresence>
        {showTranscript && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowTranscript(false)}
              className="fixed inset-0 bg-zinc-900/20 backdrop-blur-sm z-40"
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-white shadow-2xl z-50 flex flex-col"
            >
              <div className="p-6 border-bottom border-zinc-100 flex justify-between items-center">
                <h3 className="text-xl font-serif font-medium">Session Transcript</h3>
                <button 
                  onClick={() => setShowTranscript(false)}
                  className="p-2 hover:bg-zinc-100 rounded-full transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {transcript.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-zinc-400 text-center">
                    <MessageCircle size={48} className="mb-4 opacity-20" />
                    <p>No messages yet.<br/>Start speaking to see the transcript.</p>
                  </div>
                ) : (
                  transcript.map((msg, i) => (
                    <div 
                      key={i} 
                      className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                    >
                      <span className="text-[10px] uppercase tracking-widest font-bold text-zinc-400 mb-1 px-1">
                        {msg.role === 'user' ? 'You' : 'Healing with MMA'}
                      </span>
                      <div className={`
                        max-w-[85%] p-4 rounded-2xl text-sm leading-relaxed
                        ${msg.role === 'user' 
                          ? 'bg-emerald-50 text-emerald-900 rounded-tr-none' 
                          : 'bg-zinc-50 text-zinc-800 rounded-tl-none border border-zinc-100'}
                      `}>
                        <ReactMarkdown>{msg.text}</ReactMarkdown>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
      {/* Payment Feedback Toast */}
      <AnimatePresence>
        {paymentStatus && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[110] w-full max-w-sm px-6"
          >
            <div className={`p-4 rounded-2xl shadow-2xl flex items-center gap-3 ${
              paymentStatus.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
            }`}>
              {paymentStatus.type === 'success' ? <Heart size={20} fill="currentColor" /> : <AlertCircle size={20} />}
              <p className="text-sm font-medium">{paymentStatus.message}</p>
              <button onClick={() => setPaymentStatus(null)} className="ml-auto opacity-70 hover:opacity-100">
                <X size={18} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Premium Modal */}
      <AnimatePresence>
        {showPremiumModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-zinc-900/60 backdrop-blur-md"
            />
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative w-full max-w-md bg-white rounded-[32px] p-8 shadow-2xl text-center"
            >
              <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <Heart size={32} fill="currentColor" />
              </div>
              <h2 className="text-3xl font-serif font-medium text-zinc-900 mb-4">Upgrade to Premium</h2>
              <p className="text-zinc-500 mb-8 leading-relaxed">
                You've used your free trial session. To continue your healing journey with unlimited conversations, please upgrade to Premium.
              </p>
              
              <div className="bg-zinc-50 rounded-2xl p-6 mb-8 text-left">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-zinc-900 font-medium">Premium Monthly</span>
                  <span className="text-emerald-600 font-bold">₦5,000 / mo</span>
                </div>
                <ul className="text-xs text-zinc-500 space-y-2">
                  <li className="flex items-center gap-2">
                    <div className="w-1 h-1 bg-emerald-400 rounded-full" />
                    Unlimited voice conversations
                  </li>
                  <li className="flex items-center gap-2">
                    <div className="w-1 h-1 bg-emerald-400 rounded-full" />
                    Full session transcripts
                  </li>
                  <li className="flex items-center gap-2">
                    <div className="w-1 h-1 bg-emerald-400 rounded-full" />
                    Priority access to new features
                  </li>
                </ul>
              </div>

              <div className="space-y-4">
                <button 
                  onClick={handlePaystackClick}
                  disabled={isInitializingPayment}
                  className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-medium shadow-lg shadow-emerald-100 hover:bg-emerald-700 transition-all disabled:opacity-50"
                >
                  {isInitializingPayment ? 'Preparing Checkout...' : 'Pay with Paystack'}
                </button>
                <button 
                  onClick={() => setShowPremiumModal(false)}
                  className="text-zinc-400 text-sm hover:text-zinc-600 transition-colors w-full"
                >
                  Maybe later
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

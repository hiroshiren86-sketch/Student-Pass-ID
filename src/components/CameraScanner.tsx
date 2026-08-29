import React, { useEffect, useRef, useState, useCallback } from 'react';
import jsQR from 'jsqr';
import { Camera, CameraOff, RefreshCw, Zap, AlertCircle } from 'lucide-react';

interface CameraScannerProps {
  onScan: (decodedText: string) => void;
  isPaused: boolean;
}

export const CameraScanner: React.FC<CameraScannerProps> = ({ onScan, isPaused }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameId = useRef<number | null>(null);
  const currentStreamRef = useRef<MediaStream | null>(null);
  const isMountedRef = useRef<boolean>(true);

  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [lastScanned, setLastScanned] = useState<string | null>(null);

  // Scan cooldown ref to prevent duplicate triggers in rapid frames
  const lastScanTimestamp = useRef<number>(0);

  // Stop current active stream
  const stopCamera = useCallback(() => {
    if (animationFrameId.current) {
      cancelAnimationFrame(animationFrameId.current);
      animationFrameId.current = null;
    }
    if (currentStreamRef.current) {
      currentStreamRef.current.getTracks().forEach(track => track.stop());
      currentStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (isMountedRef.current) {
      setIsScanning(false);
    }
  }, []);

  // Query available cameras safely
  const refreshDevices = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter(d => d.kind === 'videoinput');
      if (isMountedRef.current) {
        setVideoDevices(videoInputs);
      }
    } catch (err) {
      console.warn('Error enumerating video devices:', err);
    }
  }, []);

  // Start Camera Stream
  const startCamera = useCallback(async (deviceIdToUse?: string) => {
    if (animationFrameId.current) {
      cancelAnimationFrame(animationFrameId.current);
      animationFrameId.current = null;
    }

    // Stop any existing stream first
    if (currentStreamRef.current) {
      currentStreamRef.current.getTracks().forEach(track => track.stop());
      currentStreamRef.current = null;
    }

    try {
      if (isMountedRef.current) {
        setErrorMessage(null);
      }

      const targetDeviceId = deviceIdToUse || selectedDeviceId;
      const constraints: MediaStreamConstraints = {
        video: targetDeviceId 
          ? { deviceId: { exact: targetDeviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (!isMountedRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }

      currentStreamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true'); // Required for iOS Safari
        
        try {
          await videoRef.current.play();
        } catch (playErr: unknown) {
          // Play request might be interrupted by unmount or device change - handle gracefully
          const playErrStr = String(playErr);
          if (!playErrStr.includes('AbortError') && !playErrStr.includes('interrupted')) {
            console.warn('Video playback warning:', playErr);
          }
        }

        if (isMountedRef.current) {
          setHasPermission(true);
          setIsScanning(true);
          refreshDevices();
        }
      }
    } catch (err: unknown) {
      if (!isMountedRef.current) return;
      const errStr = String(err);
      if (!errStr.includes('AbortError') && !errStr.includes('interrupted')) {
        console.error('Camera access error:', err);
        setHasPermission(false);
        if (errStr.includes('NotAllowedError') || errStr.includes('Permission denied')) {
          setErrorMessage('Permiso de cámara denegado. Por favor permite el acceso a la cámara en tu navegador.');
        } else if (errStr.includes('NotFoundError') || errStr.includes('DevicesNotFoundError')) {
          setErrorMessage('No se encontró ninguna cámara conectada en este dispositivo.');
        } else {
          setErrorMessage('No fue posible acceder a la cámara. Verifica los permisos de tu navegador.');
        }
        setIsScanning(false);
      }
    }
  }, [selectedDeviceId, refreshDevices]);

  // Frame processing loop using jsQR
  const tick = useCallback(() => {
    if (!videoRef.current || !canvasRef.current || isPaused) {
      if (isScanning) {
        animationFrameId.current = requestAnimationFrame(tick);
      }
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0) {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert'
        });

        if (code && code.data && code.data.trim().length > 0) {
          const now = Date.now();
          // 2.5 second cooldown per unique scan to prevent duplicate bursts
          if (now - lastScanTimestamp.current > 2500 || lastScanned !== code.data) {
            lastScanTimestamp.current = now;
            setLastScanned(code.data);
            onScan(code.data);
          }
        }
      }
    }

    if (isScanning) {
      animationFrameId.current = requestAnimationFrame(tick);
    }
  }, [isPaused, isScanning, onScan, lastScanned]);

  // Handle mount and device change lifecycle
  useEffect(() => {
    isMountedRef.current = true;
    startCamera();

    return () => {
      isMountedRef.current = false;
      stopCamera();
    };
  }, [startCamera, stopCamera]);

  useEffect(() => {
    if (isScanning) {
      animationFrameId.current = requestAnimationFrame(tick);
    }
    return () => {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
        animationFrameId.current = null;
      }
    };
  }, [isScanning, tick]);

  // Switch camera toggle
  const handleSwitchCamera = () => {
    if (videoDevices.length <= 1) return;
    const currentIndex = videoDevices.findIndex(d => d.deviceId === selectedDeviceId);
    const nextIndex = (currentIndex + 1) % videoDevices.length;
    const nextDeviceId = videoDevices[nextIndex].deviceId;
    setSelectedDeviceId(nextDeviceId);
    startCamera(nextDeviceId);
  };

  return (
    <div className="relative w-full rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 shadow-2xl flex flex-col items-center">
      {/* Top Overlay Controls */}
      <div className="absolute top-3 left-3 right-3 z-20 flex items-center justify-between pointer-events-auto">
        <div className="flex items-center gap-2 bg-slate-900/80 backdrop-blur-md px-3 py-1.5 rounded-full border border-slate-700/60 text-xs text-slate-200">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>Cámara QR Activa</span>
        </div>

        <div className="flex items-center gap-2">
          {videoDevices.length > 1 && (
            <button
              onClick={handleSwitchCamera}
              className="p-2 rounded-full bg-slate-900/80 hover:bg-slate-800 backdrop-blur-md border border-slate-700/60 text-slate-200 hover:text-white transition-colors"
              title="Cambiar Cámara"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          )}

          <button
            onClick={() => (isScanning ? stopCamera() : startCamera())}
            className="p-2 rounded-full bg-slate-900/80 hover:bg-slate-800 backdrop-blur-md border border-slate-700/60 text-slate-200 hover:text-white transition-colors"
            title={isScanning ? 'Pausar Cámara' : 'Iniciar Cámara'}
          >
            {isScanning ? <CameraOff className="w-4 h-4 text-amber-400" /> : <Camera className="w-4 h-4 text-emerald-400" />}
          </button>
        </div>
      </div>

      {/* Main Video Element */}
      <div className="relative w-full aspect-video sm:aspect-[4/3] max-h-[380px] bg-slate-950 flex items-center justify-center overflow-hidden">
        <video
          ref={videoRef}
          className="w-full h-full object-cover"
          muted
        />
        <canvas ref={canvasRef} className="hidden" />

        {/* Viewfinder Target Reticle */}
        {isScanning && !errorMessage && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center p-6">
            <div className="relative w-52 h-52 sm:w-64 sm:h-64 border-2 border-indigo-500/70 rounded-2xl bg-indigo-500/5 shadow-2xl flex items-center justify-center">
              {/* Corner Accents */}
              <div className="absolute -top-1 -left-1 w-6 h-6 border-t-4 border-l-4 border-indigo-400 rounded-tl-lg" />
              <div className="absolute -top-1 -right-1 w-6 h-6 border-t-4 border-r-4 border-indigo-400 rounded-tr-lg" />
              <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-4 border-l-4 border-indigo-400 rounded-bl-lg" />
              <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-4 border-r-4 border-indigo-400 rounded-br-lg" />

              {/* Animated Laser Scanning Line */}
              <div className="absolute left-2 right-2 h-0.5 bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_12px_rgba(34,211,238,0.9)] animate-bounce" />

              <span className="text-[11px] font-medium tracking-wide text-indigo-300/80 bg-slate-950/80 px-2 py-0.5 rounded-full border border-indigo-500/30">
                Apunta al código QR del carné
              </span>
            </div>
          </div>
        )}

        {/* Error / Permission Fallback View */}
        {errorMessage && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center p-6 text-center bg-slate-900/95 backdrop-blur-md">
            <div className="p-3 bg-rose-500/20 text-rose-400 rounded-2xl border border-rose-500/30 mb-3">
              <AlertCircle className="w-8 h-8" />
            </div>
            <h4 className="text-base font-bold text-white mb-1">Acceso a Cámara Requerido</h4>
            <p className="text-xs text-slate-300 max-w-sm mb-4">{errorMessage}</p>
            <button
              onClick={startCamera}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl shadow-lg transition-colors flex items-center gap-2"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Reintentar Permiso de Cámara
            </button>
          </div>
        )}
      </div>

      {/* Bottom helper bar */}
      <div className="w-full bg-slate-900 px-4 py-2 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
        <span className="flex items-center gap-1.5">
          <Zap className="w-3.5 h-3.5 text-amber-400" />
          <span>Detección automática de códigos QR firmados</span>
        </span>
        <span className="font-mono text-[11px] text-slate-500">jsQR Engine @ 60fps</span>
      </div>
    </div>
  );
};

import React, { useState, useRef, useEffect } from 'react';
import { Camera, X, Check, Loader2, UploadCloud, RotateCw, FileText, FileImage, Plus, Trash2 } from 'lucide-react';
import { jsPDF } from 'jspdf';

interface ScannedPage {
  id: string;
  dataUrl: string;
  width: number;
  height: number;
}

interface DocumentScannerProps {
  onClose: () => void;
  onScanComplete: (file: File) => void;
  title?: string;
  forceSingleImageOnly?: boolean;
}

export default function DocumentScanner({ onClose, onScanComplete, title = 'Numériseur de Documents', forceSingleImageOnly = false }: DocumentScannerProps) {
  // Navigation & workflow screens:
  // - 'camera': upload, drag or drop files
  // - 'crop': crop a single raw image individually with 90° rotate and validate buttons
  // - 'preview': final summary with document name, file format and validation
  const [screen, setScreen] = useState<'camera' | 'crop' | 'preview'>('camera');
  const [loading, setLoading] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  // Complete list of cropped pages
  const [pages, setPages] = useState<ScannedPage[]>([]);

  // Queue of raw dataUrls awaiting their manual cropper session
  const [cropQueue, setCropQueue] = useState<string[]>([]);

  // Active raw captured image to crop
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [imageSize, setImageSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [displayedSize, setDisplayedSize] = useState<{ width: number; height: number } | null>(null);

  // Active page preview selected on the preview screen
  const [activePreviewPage, setActivePreviewPage] = useState<ScannedPage | null>(null);

  // Form Fields
  const [documentName, setDocumentName] = useState('');
  const [exportFormat, setExportFormat] = useState<'jpeg' | 'pdf'>(forceSingleImageOnly ? 'jpeg' : 'pdf');

  // Interactive Crop boundaries (percentages 0-100)
  const [crop, setCrop] = useState({ x1: 15, y1: 15, x2: 85, y2: 85 });
  const [activeHandle, setActiveHandle] = useState<string | null>(null);
  const [dragStart, setDragStart] = useState<{
    x: number;
    y: number;
    cropStart: { x1: number; y1: number; x2: number; y2: number };
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Generate responsive default names
  useEffect(() => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    setDocumentName(`Courrier_DGI_${yyyy}-${mm}-${dd}`);
  }, []);

  // Open systems standard explorer or camera sheet
  const triggerCameraInput = () => {
    fileInputRef.current?.click();
  };

  // Safe file loader pipeline with fallback support
  const processCapturedFiles = (files: File[]) => {
    const filesToLoad = forceSingleImageOnly ? files.slice(0, 1) : files;
    setLoading(true);
    const loadedDataUrls: { dataUrl: string; width: number; height: number }[] = [];

    const readAndLoad = (index: number) => {
      if (index >= filesToLoad.length) {
        if (loadedDataUrls.length > 0) {
          // Keep first image for immediate cropping
          const first = loadedDataUrls[0];
          setCapturedImage(first.dataUrl);
          setImageSize({ width: first.width, height: first.height });
          setCrop({ x1: 15, y1: 15, x2: 85, y2: 85 });
          setDisplayedSize(null);

          // Save subsequent ones for cropping queue
          setCropQueue(forceSingleImageOnly ? [] : loadedDataUrls.slice(1).map(x => x.dataUrl));
          setScreen('crop');
        }
        setLoading(false);
        return;
      }

      const file = files[index];
      if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = (e) => {
          const dataUrl = e.target?.result as string;
          const img = new Image();
          img.onload = () => {
            loadedDataUrls.push({
              dataUrl,
              width: img.naturalWidth || img.width || 1920,
              height: img.naturalHeight || img.height || 1080
            });
            readAndLoad(index + 1);
          };
          img.onerror = () => readAndLoad(index + 1);
          img.src = dataUrl;
        };
        reader.onerror = () => readAndLoad(index + 1);
        reader.readAsDataURL(file);
      } else if (file.type === "application/pdf") {
        alert("Les documents PDF sont importés directement. Pour recadrer, faire pivoter et assembler vos pages manuellement, veuillez importer des fichiers image (PNG, JPEG, etc.).");
        onScanComplete(file);
        readAndLoad(index + 1);
      } else {
        readAndLoad(index + 1);
      }
    };

    readAndLoad(0);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      processCapturedFiles(Array.from(files));
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processCapturedFiles(Array.from(e.dataTransfer.files));
    }
  };

  // Drag interaction coordinates
  const handlePointerDown = (e: React.PointerEvent, handle: string) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setActiveHandle(handle);
    setDragStart({
      x: e.clientX,
      y: e.clientY,
      cropStart: { ...crop }
    });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!activeHandle || !dragStart || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const deltaX = ((e.clientX - dragStart.x) / rect.width) * 100;
    const deltaY = ((e.clientY - dragStart.y) / rect.height) * 100;

    setCrop(() => {
      let { x1, y1, x2, y2 } = dragStart.cropStart;
      const minSize = 10;

      switch (activeHandle) {
        case 'TL':
          x1 = Math.max(0, Math.min(dragStart.cropStart.x2 - minSize, dragStart.cropStart.x1 + deltaX));
          y1 = Math.max(0, Math.min(dragStart.cropStart.y2 - minSize, dragStart.cropStart.y1 + deltaY));
          break;
        case 'TR':
          x2 = Math.min(100, Math.max(dragStart.cropStart.x1 + minSize, dragStart.cropStart.x2 + deltaX));
          y1 = Math.max(0, Math.min(dragStart.cropStart.y2 - minSize, dragStart.cropStart.y1 + deltaY));
          break;
        case 'BR':
          x2 = Math.min(100, Math.max(dragStart.cropStart.x1 + minSize, dragStart.cropStart.x2 + deltaX));
          y2 = Math.min(100, Math.max(dragStart.cropStart.y1 + minSize, dragStart.cropStart.y2 + deltaY));
          break;
        case 'BL':
          x1 = Math.max(0, Math.min(dragStart.cropStart.x2 - minSize, dragStart.cropStart.x1 + deltaX));
          y2 = Math.min(100, Math.max(dragStart.cropStart.y1 + minSize, dragStart.cropStart.y2 + deltaY));
          break;
        case 'T':
          y1 = Math.max(0, Math.min(dragStart.cropStart.y2 - minSize, dragStart.cropStart.y1 + deltaY));
          break;
        case 'B':
          y2 = Math.min(100, Math.max(dragStart.cropStart.y1 + minSize, dragStart.cropStart.y2 + deltaY));
          break;
        case 'L':
          x1 = Math.max(0, Math.min(dragStart.cropStart.x2 - minSize, dragStart.cropStart.x1 + deltaX));
          break;
        case 'R':
          x2 = Math.min(100, Math.max(dragStart.cropStart.x1 + minSize, dragStart.cropStart.x2 + deltaX));
          break;
        case 'center':
          const w = dragStart.cropStart.x2 - dragStart.cropStart.x1;
          const h = dragStart.cropStart.y2 - dragStart.cropStart.y1;
          let newX1 = dragStart.cropStart.x1 + deltaX;
          let newY1 = dragStart.cropStart.y1 + deltaY;

          if (newX1 < 0) newX1 = 0;
          if (newX1 + w > 100) newX1 = 100 - w;
          if (newY1 < 0) newY1 = 0;
          if (newY1 + h > 100) newY1 = 100 - h;

          x1 = newX1;
          y1 = newY1;
          x2 = newX1 + w;
          y2 = newY1 + h;
          break;
      }

      return { x1, y1, x2, y2 };
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (e.target) {
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch (ignore) {}
    }
    setActiveHandle(null);
    setDragStart(null);
  };

  const handleImgLoad = () => {
    if (imgRef.current) {
      setDisplayedSize({
        width: imgRef.current.clientWidth,
        height: imgRef.current.clientHeight,
      });
    }
  };

  // Clockwise 90 degrees rotation directly inside the active crop workspace screen
  const rotateCropImage90Degrees = () => {
    if (!capturedImage) return;
    setLoading(true);

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.height;
      canvas.height = img.width;

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((90 * Math.PI) / 180);
        ctx.drawImage(img, -img.width / 2, -img.height / 2);

        const rotatedBase64 = canvas.toDataURL('image/jpeg', 0.95);
        setCapturedImage(rotatedBase64);
        setImageSize({ width: canvas.width, height: canvas.height });
        setCrop({ x1: 15, y1: 15, x2: 85, y2: 85 });
        setDisplayedSize(null);
      }
      setLoading(false);
    };
    img.src = capturedImage;
  };

  // Commit crop of the active raw photo
  const handleValidateAndCropItem = () => {
    if (!capturedImage) return;
    setLoading(true);

    const img = new Image();
    img.onload = () => {
      const px = (crop.x1 / 100) * imageSize.width;
      const py = (crop.y1 / 100) * imageSize.height;
      const pw = ((crop.x2 - crop.x1) / 100) * imageSize.width;
      const ph = ((crop.y2 - crop.y1) / 100) * imageSize.height;

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(10, Math.round(pw));
      canvas.height = Math.max(10, Math.round(ph));

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, px, py, pw, ph, 0, 0, canvas.width, canvas.height);
        const croppedBase64 = canvas.toDataURL('image/jpeg', 0.95);

        const newPage: ScannedPage = {
          id: `page_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          dataUrl: croppedBase64,
          width: canvas.width,
          height: canvas.height
        };

        // Update list of pages
        setPages(prev => {
          const updated = [...prev, newPage];
          // Keep active pointer in preview
          setActivePreviewPage(newPage);
          return updated;
        });

        // Pull next image from cropQueue if available
        if (cropQueue.length > 0) {
          const nextUrl = cropQueue[0];
          setCropQueue(prev => prev.slice(1));

          const nextImg = new Image();
          nextImg.onload = () => {
            setCapturedImage(nextUrl);
            setImageSize({
              width: nextImg.naturalWidth || nextImg.width || 1920,
              height: nextImg.naturalHeight || nextImg.height || 1080
            });
            setCrop({ x1: 15, y1: 15, x2: 85, y2: 85 });
            setDisplayedSize(null);
            setScreen('crop');
            setLoading(false);
          };
          nextImg.src = nextUrl;
        } else {
          // No more files in line. Proceed to preview summary
          setScreen('preview');
          setLoading(false);
        }
      } else {
        alert("Erreur lors de l'assemblage de l'image.");
        setLoading(false);
      }
    };
    img.src = capturedImage;
  };

  const handleCancelCrop = () => {
    // Clear crop temp buffer and return to upload dashboard
    setCapturedImage(null);
    setCropQueue([]);
    setScreen('camera');
  };

  // Clockwise rotation of page on preview screen
  const rotatePreviewPage90Degrees = () => {
    if (!activePreviewPage) return;
    setLoading(true);

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.height;
      canvas.height = img.width;

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((90 * Math.PI) / 180);
        ctx.drawImage(img, -img.width / 2, -img.height / 2);

        const rotatedBase64 = canvas.toDataURL('image/jpeg', 0.95);
        
        const updatedPage = {
          ...activePreviewPage,
          dataUrl: rotatedBase64,
          width: canvas.width,
          height: canvas.height
        };

        setPages(prev => prev.map(p => p.id === activePreviewPage.id ? updatedPage : p));
        setActivePreviewPage(updatedPage);
      }
      setLoading(false);
    };
    img.src = activePreviewPage.dataUrl;
  };

  const deletePageFromList = (id: string) => {
    const remaining = pages.filter(p => p.id !== id);
    setPages(remaining);
    
    if (activePreviewPage?.id === id) {
      setActivePreviewPage(remaining.length > 0 ? remaining[remaining.length - 1] : null);
    }
    
    if (remaining.length === 0) {
      setScreen('camera');
    }
  };

  // Convert files
  const dataURLtoBlob = (dataurl: string) => {
    const arr = dataurl.split(',');
    const match = arr[0].match(/:(.*?);/);
    const mime = match ? match[1] : 'image/jpeg';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  };

  const executeFinalCompilation = () => {
    if (pages.length === 0) {
      alert("Erreur : Aucune page n'a été scannée.");
      return;
    }

    const trimmedName = documentName.trim() || `Courrier_DGI_${Date.now()}`;
    setLoading(true);

    try {
      if (pages.length > 1 || exportFormat === 'pdf') {
        const first = pages[0];
        const doc = new jsPDF({
          orientation: first.width > first.height ? 'l' : 'p',
          unit: 'px',
          format: [first.width, first.height],
          compress: true
        });

        pages.forEach((p, idx) => {
          if (idx > 0) {
            doc.addPage([p.width, p.height], p.width > p.height ? 'l' : 'p');
          }
          doc.addImage(p.dataUrl, 'JPEG', 0, 0, p.width, p.height);
        });

        const pdfBlob = doc.output('blob');
        const pdfFile = new File([pdfBlob], `${trimmedName}.pdf`, { type: 'application/pdf' });
        onScanComplete(pdfFile);
        onClose();
      } else {
        const jpegBlob = dataURLtoBlob(pages[0].dataUrl);
        const jpegFile = new File([jpegBlob], `${trimmedName}.jpg`, { type: 'image/jpeg' });
        onScanComplete(jpegFile);
        onClose();
      }
    } catch (err) {
      console.error("PDF/JPEG Compilation error:", err);
      alert("Une erreur est survenue lors de l'assemblage du document final.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] bg-zinc-950 flex flex-col justify-between text-white p-4 md:p-6 select-none font-sans overflow-y-auto">
      
      {/* Hidden standard file trigger */}
      <input 
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Header bar */}
      <div className="flex items-center justify-between h-14 border-b border-zinc-800 shrink-0">
        <div>
          <h2 className="text-sm font-black text-white italic uppercase tracking-wider">{title}</h2>
          <p className="text-[9px] text-cyan-500 font-bold uppercase tracking-widest leading-none mt-1">
            Numérisateur Ultra Rapide • Mode Manuel &amp; Libre
          </p>
        </div>
        <button 
          onClick={onClose}
          className="p-3 bg-zinc-900 rounded-2xl text-zinc-400 hover:text-white transition-all shadow-inner cursor-pointer"
        >
          <X size={18} />
        </button>
      </div>

      {/* Workspace Display */}
      <div className="flex-1 my-4 flex flex-col items-center justify-center relative bg-black rounded-3xl border border-zinc-900 shadow-2xl min-h-[400px]">
        
        {/* VIEW 1: Shutter / Upload Dashboard */}
        {screen === 'camera' && (
          <div 
            onDragEnter={handleDrag}
            onDragOver={handleDrag}
            onDragLeave={handleDrag}
            onDrop={handleDrop}
            className={`relative w-full h-full flex flex-col items-center justify-center p-6 text-center transition-all ${
              dragActive ? "bg-cyan-950/20 border-2 border-dashed border-cyan-500/50" : ""
            }`}
          >
            {loading ? (
              <div className="flex flex-col items-center justify-center gap-3">
                <Loader2 className="animate-spin text-cyan-500" size={36} />
                <span className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase animate-pulse">
                  Acquisition du document...
                </span>
              </div>
            ) : (
              <div className="max-w-md w-full flex flex-col items-center">
                
                <div className="relative group mb-6">
                  <div className="absolute inset-0 bg-cyan-500/20 rounded-full blur-2xl group-hover:bg-cyan-500/30 transition-all opacity-70 animate-pulse duration-3000" />
                  <div className="relative w-24 h-24 bg-zinc-900 border border-zinc-800 rounded-3xl flex items-center justify-center text-zinc-400 group-hover:text-white group-hover:border-zinc-700 transition-all shadow-inner">
                    <Camera size={38} />
                  </div>
                </div>

                <h3 className="text-sm font-black text-zinc-200 uppercase tracking-wider mb-2">
                  Prendre une Photo ou Sélectionner
                </h3>
                <p className="text-[11px] text-zinc-500 leading-relaxed font-semibold max-w-xs mb-8">
                  Ouvrez l'appareil photo ou sélectionnez des fichiers stockés sur votre smartphone ou PC.
                </p>

                <button 
                  onClick={triggerCameraInput}
                  className="px-8 py-5 bg-white text-zinc-950 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-zinc-100 transition-all shadow-2xl hover:scale-105 active:scale-95 cursor-pointer flex items-center gap-3"
                >
                  <Camera size={16} />
                  Choisir ou capturer
                </button>

                {pages.length > 0 && (
                  <div className="mt-8 px-4 py-2 bg-cyan-950/30 border border-cyan-800/40 rounded-xl flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                    <span className="text-[10px] font-black font-mono text-cyan-400 uppercase tracking-wider">
                      {pages.length} page{pages.length > 1 ? 's' : ''} scannée{pages.length > 1 ? 's' : ''}
                    </span>
                  </div>
                )}

                <div className="mt-12 flex items-center gap-2 text-zinc-600 text-[10px] font-bold uppercase tracking-widest">
                  <UploadCloud size={14} />
                  <span>Glissez-déposez des photos ici</span>
                </div>

              </div>
            )}
          </div>
        )}

        {/* VIEW 2: Precision Individual Crop Screen (Clean & Fullscreen) */}
        {screen === 'crop' && (
          <div className="w-full h-full flex flex-col justify-between items-center p-4 gap-4">
            
            {/* Direct crop canvas view */}
            <div 
              ref={containerRef}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              className="relative flex-1 max-h-[50vh] w-full bg-zinc-950 flex items-center justify-center rounded-2xl overflow-hidden touch-none border border-zinc-900"
            >
              <img 
                ref={imgRef}
                src={capturedImage || undefined} 
                onLoad={handleImgLoad}
                alt="Active Crop Target" 
                className="max-h-[50vh] max-w-full object-contain pointer-events-none select-none opacity-90"
              />
              
              {displayedSize && (
                <div 
                  className="absolute overflow-hidden"
                  style={{
                    width: `${displayedSize.width}px`,
                    height: `${displayedSize.height}px`,
                  }}
                >
                  {/* Bounding overlay representing the selection box */}
                  <div 
                    className="absolute border-2 border-white/85 box-border pointer-events-auto shadow-[0_0_15px_rgba(0,0,0,0.5)]"
                    style={{
                      left: `${crop.x1}%`,
                      top: `${crop.y1}%`,
                      width: `${crop.x2 - crop.x1}%`,
                      height: `${crop.y2 - crop.y1}%`,
                      boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.70)'
                    }}
                  >
                    {/* Thirds guide grids */}
                    <div className="absolute inset-0 border border-white/20 pointer-events-none">
                      <div className="absolute inset-x-0 top-1/3 border-b border-white/20" />
                      <div className="absolute inset-x-0 bottom-1/3 border-b border-white/20" />
                      <div className="absolute inset-y-0 left-1/3 border-r border-white/20" />
                      <div className="absolute inset-y-0 right-1/3 border-r border-white/20" />
                    </div>

                    {/* Resize Corners */}
                    <div 
                      onPointerDown={(e) => handlePointerDown(e, 'TL')}
                      className="absolute -left-2.5 -top-2.5 w-8 h-8 cursor-nwse-resize select-none flex items-start justify-start active:scale-125 transition-transform"
                    >
                      <div className="w-5 h-5 border-l-[5px] border-t-[5px] border-white shadow-[0_0_5px_rgba(0,0,0,0.6)]" />
                    </div>

                    <div 
                      onPointerDown={(e) => handlePointerDown(e, 'TR')}
                      className="absolute -right-2.5 -top-2.5 w-8 h-8 cursor-nesw-resize select-none flex items-start justify-end active:scale-125 transition-transform"
                    >
                      <div className="w-5 h-5 border-r-[5px] border-t-[5px] border-white shadow-[0_0_5px_rgba(0,0,0,0.6)]" />
                    </div>

                    <div 
                      onPointerDown={(e) => handlePointerDown(e, 'BR')}
                      className="absolute -right-2.5 -bottom-2.5 w-8 h-8 cursor-nwse-resize select-none flex items-end justify-end active:scale-125 transition-transform"
                    >
                      <div className="w-5 h-5 border-r-[5px] border-b-[5px] border-white shadow-[0_0_5px_rgba(0,0,0,0.6)]" />
                    </div>

                    <div 
                      onPointerDown={(e) => handlePointerDown(e, 'BL')}
                      className="absolute -left-2.5 -bottom-2.5 w-8 h-8 cursor-nesw-resize select-none flex items-end justify-start active:scale-125 transition-transform"
                    >
                      <div className="w-5 h-5 border-l-[5px] border-b-[5px] border-white shadow-[0_0_5px_rgba(0,0,0,0.6)]" />
                    </div>

                    {/* Edge Axis Resizers */}
                    <div 
                      onPointerDown={(e) => handlePointerDown(e, 'T')}
                      className="absolute inset-x-8 -top-2.5 h-5 cursor-ns-resize flex items-center justify-center"
                    >
                      <div className="w-8 h-1.5 bg-neutral-150 rounded-full shadow-[0_0_5px_rgba(0,0,0,0.6)]" />
                    </div>

                    <div 
                      onPointerDown={(e) => handlePointerDown(e, 'B')}
                      className="absolute inset-x-8 -bottom-2.5 h-5 cursor-ns-resize flex items-center justify-center"
                    >
                      <div className="w-8 h-1.5 bg-neutral-150 rounded-full shadow-[0_0_5px_rgba(0,0,0,0.6)]" />
                    </div>

                    <div 
                      onPointerDown={(e) => handlePointerDown(e, 'L')}
                      className="absolute inset-y-8 -left-2.5 w-5 cursor-ew-resize flex items-center justify-center"
                    >
                      <div className="h-8 w-1.5 bg-neutral-150 rounded-full shadow-[0_0_5px_rgba(0,0,0,0.6)]" />
                    </div>

                    <div 
                      onPointerDown={(e) => handlePointerDown(e, 'R')}
                      className="absolute inset-y-8 -right-2.5 w-5 cursor-ew-resize flex items-center justify-center"
                    >
                      <div className="h-8 w-1.5 bg-neutral-150 rounded-full shadow-[0_0_5px_rgba(0,0,0,0.6)]" />
                    </div>

                    <div 
                      onPointerDown={(e) => handlePointerDown(e, 'center')}
                      className="absolute inset-4 cursor-move bg-transparent"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* DIRECT USER CONTROLS: Annuler, Flipper 90° & Valider le Rognage */}
            <div className="w-full max-w-lg flex flex-col sm:flex-row items-center gap-3 bg-zinc-900/60 p-3.5 rounded-2xl border border-zinc-850">
              <button 
                onClick={handleCancelCrop}
                className="w-full sm:flex-1 py-3 px-4 bg-zinc-800 hover:bg-zinc-750 text-zinc-350 hover:text-white rounded-xl text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer text-center"
              >
                Annuler / Reprendre
              </button>

              <button 
                onClick={rotateCropImage90Degrees}
                disabled={loading}
                className="w-full sm:flex-1 py-3 px-4 bg-zinc-800 hover:bg-zinc-750 text-cyan-400 hover:text-cyan-300 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-2 border border-cyan-950"
              >
                <RotateCw size={12} className={loading ? "animate-spin" : ""} />
                Faire pivoter 90°
              </button>

              <button 
                onClick={handleValidateAndCropItem}
                disabled={loading}
                className="w-full sm:flex-1 py-3 px-4 bg-white hover:bg-neutral-100 text-zinc-950 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all shadow-md cursor-pointer flex items-center justify-center gap-1.5"
              >
                {loading ? <Loader2 className="animate-spin text-zinc-950" size={13} /> : <Check size={13} />}
                Valider le rognage
              </button>
            </div>

          </div>
        )}

        {/* VIEW 3: Final preview synthesis page (with formatting, thumbnails lists, sorting, document name) */}
        {screen === 'preview' && activePreviewPage && (
          <div className="w-full h-full flex flex-col md:flex-row p-4 md:p-6 gap-6 overflow-y-auto max-h-[75vh]">
            
            {/* Selected Active page thumbnail view with rotators */}
            <div className="flex-1 flex flex-col items-center justify-center bg-zinc-950 border border-zinc-900 rounded-2xl p-4 relative min-h-[300px]">
              <div className="absolute top-3 left-3 bg-zinc-900 px-3 py-1 rounded-md text-[9px] font-bold text-zinc-400 font-mono">
                Aperçu Page Active
              </div>

              {loading ? (
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="animate-spin text-cyan-500" size={24} />
                  <span className="text-[10px] font-bold uppercase text-zinc-500 tracking-wider">Rotation...</span>
                </div>
              ) : (
                <img 
                  src={activePreviewPage.dataUrl} 
                  alt="Cropped Page Active" 
                  className="max-h-[35vh] max-w-full object-contain rounded-lg border border-zinc-800 shadow-2xl"
                />
              )}

              <button 
                onClick={rotatePreviewPage90Degrees}
                disabled={loading}
                className="mt-4 px-4 py-2 bg-zinc-900 hover:bg-zinc-800 border-zinc-800 border rounded-xl text-[9px] font-black uppercase tracking-wider text-zinc-300 hover:text-white transition-all flex items-center gap-2 cursor-pointer shadow-sm"
              >
                <RotateCw size={12} className={loading ? "animate-spin" : ""} />
                Faire pivoter 90°
              </button>
            </div>

            {/* Document Forms Sidebar Parameters */}
            <div className="w-full md:w-80 flex flex-col justify-between gap-5 border-t md:border-t-0 md:border-l border-zinc-900 pt-5 md:pt-0 md:pl-5 shrink-0">
              
              <div className="space-y-4">
                
                {/* File input title */}
                <div>
                  <label className="block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1">
                    Nom du Document <span className="text-red-500">*</span>
                  </label>
                  <input 
                    type="text"
                    value={documentName}
                    onChange={(e) => setDocumentName(e.target.value)}
                    placeholder="Saisissez un nom officiel..."
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3.5 py-3 text-xs text-white font-bold outline-none focus:border-cyan-500/50 transition-all font-mono"
                  />
                </div>

                {/* SINGLE Page export format chooser OR LOCK on unified PDF if multiple pages */}
                {pages.length === 1 ? (
                  <div>
                    <label className="block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2">
                      Format d'exportation
                    </label>
                    {forceSingleImageOnly ? (
                      <div className="p-3 bg-cyan-950/25 border border-cyan-800/40 rounded-xl">
                        <span className="block text-[9.5px]/[normal] font-black uppercase text-cyan-400 tracking-wider mb-1 flex items-center gap-1.5">
                          🖼️ Format Image Obligatoire (PNG/JPEG)
                        </span>
                        <p className="text-[9px] text-zinc-500 font-bold leading-normal uppercase">
                          La signature/cachet numérisé sera extrait au format image JPEG transparent.
                        </p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-3">
                        <button 
                          type="button"
                          onClick={() => setExportFormat('pdf')}
                          className={`py-3 rounded-xl border text-center transition-all cursor-pointer flex flex-col items-center justify-center gap-1 ${
                            exportFormat === 'pdf' 
                              ? "bg-cyan-950/40 border-cyan-500 text-cyan-400" 
                              : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-700"
                          }`}
                        >
                          <FileText size={16} />
                          <span className="text-[9px] font-black uppercase tracking-wider">Format PDF</span>
                        </button>

                        <button 
                          type="button"
                          onClick={() => setExportFormat('jpeg')}
                          className={`py-3 rounded-xl border text-center transition-all cursor-pointer flex flex-col items-center justify-center gap-1 ${
                            exportFormat === 'jpeg' 
                              ? "bg-cyan-950/40 border-cyan-500 text-cyan-400" 
                              : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-700"
                          }`}
                        >
                          <FileImage size={16} />
                          <span className="text-[9px] font-black uppercase tracking-wider">Format JPEG</span>
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-3 bg-cyan-950/20 border border-cyan-800/30 rounded-xl">
                    <span className="block text-[9px] font-black uppercase text-cyan-400 tracking-wider mb-1">
                      📄 Export Unifié Obligatoire (PDF)
                    </span>
                    <p className="text-[9px] text-zinc-500 font-semibold leading-relaxed">
                      {pages.length} pages cumulées. Toutes les pages seront fusionnées au sein d'un UNIQUE document PDF.
                    </p>
                  </div>
                )}

                {/* Scanned thumbs catalog lists */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">
                      Pages du Document ({pages.length})
                    </span>
                  </div>

                  <div className="flex items-center gap-2.5 overflow-x-auto pb-2 scrollbar-thin">
                    {pages.map((p, idx) => (
                      <div 
                        key={p.id} 
                        onClick={() => setActivePreviewPage(p)}
                        className={`relative w-14 h-18 rounded-lg shrink-0 overflow-hidden cursor-pointer border transition-all group ${
                          activePreviewPage?.id === p.id ? "border-cyan-500 scale-105" : "border-zinc-800"
                        }`}
                      >
                        <img src={p.dataUrl} className="w-full h-full object-cover" alt={`P. ${idx + 1}`} />
                        <div className="absolute top-1 left-1 bg-black/85 px-1.5 rounded text-[8px] font-extrabold font-mono">
                          {idx + 1}
                        </div>
                        
                        {/* Overlay delete button */}
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            deletePageFromList(p.id);
                          }}
                          className="absolute inset-0 bg-red-950/75 flex items-center justify-center text-red-400 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                          title="Supprimer cette page"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    ))}

                    {/* Quick snap plus button */}
                    {!forceSingleImageOnly && (
                      <button 
                        onClick={() => setScreen('camera')}
                        className="w-14 h-18 bg-zinc-900 border border-dashed border-zinc-800 rounded-lg flex flex-col items-center justify-center text-zinc-400 hover:text-cyan-400 hover:border-cyan-900 transition-all cursor-pointer"
                        title="Scanner une autre page"
                      >
                        <Plus size={13} />
                        <span className="text-[7px] font-bold uppercase tracking-wider mt-1">Ajouter</span>
                      </button>
                    )}
                  </div>
                </div>

              </div>

              {/* Confirm submit layout button controls */}
              <div className="pt-4 border-t border-zinc-900 flex flex-col gap-2 shrink-0">
                <button 
                  onClick={() => setScreen('camera')}
                  className="w-full py-3 bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 text-[10px] font-black uppercase tracking-wider text-zinc-300 rounded-xl hover:text-white transition-all cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <Plus size={13} />
                  Scanner autre page
                </button>

                <button 
                  disabled={loading}
                  onClick={executeFinalCompilation}
                  className="w-full py-4 bg-white text-zinc-950 hover:bg-slate-100 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-xl cursor-pointer flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <Loader2 className="animate-spin text-zinc-950" size={15} />
                  ) : (
                    <>
                      <Check size={15} />
                      Valider et Envoyer au Chat/GED
                    </>
                  )}
                </button>
              </div>

            </div>

          </div>
        )}

      </div>

      {/* Persistent HUD Footer status bar */}
      <div className="h-14 border-t border-zinc-900 flex items-center justify-between px-2 shrink-0">
        <span className="text-[9px] text-zinc-600 font-bold uppercase tracking-widest shrink-0">
          {screen === 'camera' && "Statut: Dépôt et Acquisition document"}
          {screen === 'crop' && "Statut: Ajustement cadrage manuel"}
          {screen === 'preview' && `Statut: Vue document (${pages.length} pages)`}
        </span>
        <span className="text-[9px] text-zinc-650 font-bold font-mono tracking-tighter shrink-0">
          V2.2.0 • ACQUISITION &amp; MULTIPAGE PIPELINE
        </span>
      </div>

    </div>
  );
}

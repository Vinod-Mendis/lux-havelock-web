'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import Image from 'next/image';
import { RotateCw, Image as ImageIcon, ChevronLeft, ChevronRight, X, ExternalLink, MessageSquare } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

interface ImageRecord {
  _id: string;
  'image-url': string;
  status?: 'sent' | 'pending' | 'failed' | null;
  'whatsapp-number'?: string;
}

const ITEMS_PER_PAGE = 15; // 3 rows of 5 columns on desktop

const getFilename = (url?: string) => {
  if (!url) return 'Unnamed Image';
  return url.substring(url.lastIndexOf('/') + 1);
};

export default function Gallery() {
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [activeImageIndex, setActiveImageIndex] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(1);
  
  // WhatsApp Form states inside Modal
  const [whatsappInput, setWhatsappInput] = useState<string>('');
  const [isUpdatingStatus, setIsUpdatingStatus] = useState<boolean>(false);
  const [updateMessage, setUpdateMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  // Ref to store the newest image ID for delta polling
  const latestIdRef = useRef<string | null>(null);

  // Sync ref whenever images list changes
  useEffect(() => {
    if (images.length > 0) {
      latestIdRef.current = images[0]._id;
    } else {
      latestIdRef.current = null;
    }
  }, [images]);

  // Fetch images from API (with incremental fetching support)
  const fetchImages = async (isPoll = false, showSpinner = false) => {
    if (showSpinner) setIsRefreshing(true);
    try {
      const sinceId = isPoll ? latestIdRef.current : null;
      const url = sinceId ? `/api/images?sinceId=${sinceId}` : '/api/images';

      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch images');
      const data = await res.json();
      
      if (data.success) {
        if (sinceId) {
          // Delta poll: prepend newly created images to state
          if (data.images && data.images.length > 0) {
            setImages((prev) => {
              const newImages = data.images.filter(
                (newImg: any) => !prev.some((oldImg) => oldImg._id === newImg._id)
              );
              if (newImages.length === 0) return prev;
              return [...newImages, ...prev];
            });
          }
        } else {
          // Full load or reload
          setImages(data.images);
        }
        setError(null);
      } else {
        throw new Error(data.error || 'Unknown error occurred');
      }
    } catch (err: any) {
      console.error(err);
      if (!isPoll) {
        setError(err.message || 'Failed to connect to the database');
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  // Initial fetch and 5-second delta polling schedule
  useEffect(() => {
    fetchImages(false, false);

    const interval = setInterval(() => {
      fetchImages(true, false);
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  // Pagination calculations
  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(images.length / ITEMS_PER_PAGE));
  }, [images]);

  // Adjust page number if it exceeds total pages
  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [totalPages, currentPage]);

  const paginatedImages = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return images.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [images, currentPage]);

  // Active image in lightbox (relative to paginated images)
  const activeImage = useMemo(() => {
    if (activeImageIndex === null || activeImageIndex < 0 || activeImageIndex >= paginatedImages.length) {
      return null;
    }
    return paginatedImages[activeImageIndex];
  }, [paginatedImages, activeImageIndex]);

  // Construct the QR Code URL
  const qrUrl = useMemo(() => {
    if (!activeImage) return '';
    const domain = process.env.NEXT_PUBLIC_QR_DOMAIN || 'domain.com';
    const baseDomain = domain.startsWith('http://') || domain.startsWith('https://') 
      ? domain 
      : `https://${domain}`;
    return `${baseDomain}/${activeImage._id}`;
  }, [activeImage]);

  // Handle opening lightbox / switching slides
  const openLightbox = (index: number) => {
    setActiveImageIndex(index);
    const img = paginatedImages[index];
    setWhatsappInput(img?.['whatsapp-number'] || '94772462795');
    setUpdateMessage(null);
  };

  // Lightbox keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (activeImageIndex === null) return;
      if (e.key === 'Escape') {
        setActiveImageIndex(null);
      } else if (e.key === 'ArrowRight') {
        if (activeImageIndex < paginatedImages.length - 1) {
          openLightbox(activeImageIndex + 1);
        }
      } else if (e.key === 'ArrowLeft') {
        if (activeImageIndex > 0) {
          openLightbox(activeImageIndex - 1);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeImageIndex, paginatedImages]);

  // Pagination navigation helpers
  const handlePrevPage = () => {
    setCurrentPage((prev) => Math.max(1, prev - 1));
  };

  const handleNextPage = () => {
    setCurrentPage((prev) => Math.min(totalPages, prev + 1));
  };

  // Submit WhatsApp update & status reset
  const handleUpdateStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeImage) return;

    setIsUpdatingStatus(true);
    setUpdateMessage(null);

    try {
      const res = await fetch('/api/images', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: activeImage._id,
          phoneNumber: whatsappInput.trim(),
        }),
      });

      const data = await res.json();
      if (data.success) {
        setUpdateMessage({ type: 'success', text: 'WhatsApp queued as pending!' });
        
        // Update images array optimistically
        setImages((prev) =>
          prev.map((img) =>
            img._id === activeImage._id
              ? { ...img, status: 'pending', 'whatsapp-number': whatsappInput.trim() }
              : img
          )
        );
      } else {
        throw new Error(data.error || 'Failed to update status');
      }
    } catch (err: any) {
      setUpdateMessage({ type: 'error', text: err.message || 'Error updating status' });
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#070709] text-zinc-100 font-sans antialiased selection:bg-violet-500/30 selection:text-violet-200 flex flex-col justify-between">
      
      {/* Background glow decorations */}
      <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-violet-600/5 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-teal-500/5 rounded-full blur-[100px] pointer-events-none" />

      {/* Main Content Area */}
      <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 relative z-10 flex-1 flex flex-col">
        
        {/* Header & Action controls */}
        <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-zinc-800/60 pb-6 mb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white bg-clip-text bg-gradient-to-r from-white via-zinc-200 to-zinc-400 flex items-center gap-2">
              Lumina Gallery
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500"></span>
              </span>
            </h1>
            <p className="text-xs sm:text-sm text-zinc-400 mt-0.5">
              Live sync active • Updates every 5 seconds.
            </p>
          </div>

          {/* Manual Refresh Button */}
          <button
            onClick={() => fetchImages(false, true)}
            disabled={isRefreshing}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800/70 text-zinc-200 hover:text-white rounded-lg transition duration-200 font-medium text-xs disabled:opacity-50 cursor-pointer self-start sm:self-auto"
          >
            <RotateCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-violet-400' : ''}`} />
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </header>

        {/* Error Alert */}
        {error && (
          <div className="bg-rose-950/20 border border-rose-900/30 rounded-xl p-4 mb-6 text-sm text-rose-300">
            {error}
          </div>
        )}

        {/* Gallery Grid Wrapper (Top-aligned justify-start) */}
        <div className="flex-1 flex flex-col justify-start">
          {isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {[...Array(15)].map((_, i) => (
                <div key={i} className="aspect-square bg-zinc-900/40 border border-zinc-800/40 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : paginatedImages.length === 0 ? (
            
            /* Empty State */
            <div className="bg-zinc-900/10 border border-zinc-800/30 rounded-xl p-16 text-center max-w-lg mx-auto w-full">
              <ImageIcon className="w-12 h-12 text-zinc-650 mx-auto mb-3" />
              <p className="text-zinc-400 font-medium">No images found</p>
            </div>
          ) : (
            
            /* Gallery Grid (Fixed 15 items, 3 rows of 5 columns on desktop) */
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {paginatedImages.map((image, index) => {
                const nameStr = getFilename(image['image-url']);
                return (
                  <div
                    key={image._id}
                    onClick={() => openLightbox(index)}
                    className="group relative aspect-square bg-[#0f0f13] border border-zinc-855 hover:border-zinc-700 rounded-lg overflow-hidden transition duration-300 shadow-md cursor-pointer"
                  >
                    <Image
                      src={image['image-url']}
                      alt={nameStr}
                      width={300}
                      height={300}
                      className="w-full h-full object-cover transition duration-500 group-hover:scale-105"
                      priority={index < 5}
                    />
                    
                    {/* Status Dot indicator */}
                    {image.status && (
                      <div className="absolute top-2.5 right-2.5">
                        {image.status === 'sent' && (
                          <span className="flex w-2 h-2 bg-emerald-500 rounded-full shadow-[0_0_6px_#10b981]" />
                        )}
                        {image.status === 'pending' && (
                          <span className="flex w-2 h-2 bg-amber-500 rounded-full shadow-[0_0_6px_#f59e0b] animate-pulse" />
                        )}
                        {image.status === 'failed' && (
                          <span className="flex w-2 h-2 bg-rose-500 rounded-full shadow-[0_0_6px_#f43f5e]" />
                        )}
                      </div>
                    )}
                    
                    {/* Subtle hover overlay to showcase filename */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition duration-200 flex items-end p-3">
                      <span className="text-[10px] font-medium text-white truncate w-full">
                        {nameStr}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Footer with Pagination */}
      <footer className="border-t border-zinc-800/60 bg-[#08080a]/65 backdrop-blur-md py-4 relative z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          
          {/* Item Count */}
          <div className="text-xs text-zinc-400">
            Showing <span className="font-semibold text-zinc-200">
              {images.length === 0 ? 0 : (currentPage - 1) * ITEMS_PER_PAGE + 1}
            </span> to <span className="font-semibold text-zinc-200">
              {Math.min(currentPage * ITEMS_PER_PAGE, images.length)}
            </span> of <span className="font-semibold text-zinc-200">{images.length}</span> images
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              {/* Prev Button */}
              <button
                onClick={handlePrevPage}
                disabled={currentPage === 1}
                className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-800 disabled:opacity-40 disabled:hover:bg-zinc-900 disabled:hover:text-zinc-400 transition duration-200 cursor-pointer"
                aria-label="Previous Page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              {/* Page Numbers */}
              <div className="flex items-center gap-1">
                {[...Array(totalPages)].map((_, i) => {
                  const pageNum = i + 1;
                  return (
                    <button
                      key={pageNum}
                      onClick={() => setCurrentPage(pageNum)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition duration-150 cursor-pointer ${
                        currentPage === pageNum
                          ? 'bg-violet-600 text-white shadow-[0_0_8px_rgba(139,92,246,0.35)]'
                          : 'bg-zinc-900 text-zinc-400 hover:text-white hover:bg-zinc-800'
                      }`}
                    >
                      {pageNum}
                    </button>
                  );
                })}
              </div>

              {/* Next Button */}
              <button
                onClick={handleNextPage}
                disabled={currentPage === totalPages}
                className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-800 disabled:opacity-40 disabled:hover:bg-zinc-900 disabled:hover:text-zinc-400 transition duration-200 cursor-pointer"
                aria-label="Next Page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

        </div>
      </footer>

      {/* Lightbox / Modal */}
      {activeImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/95 backdrop-blur-sm">
          
          {/* Close target */}
          <div className="absolute inset-0" onClick={() => setActiveImageIndex(null)} />

          {/* Modal Container */}
          <div className="relative w-full max-w-4xl bg-[#0f0f13] border border-zinc-800 rounded-xl overflow-hidden shadow-2xl z-10 flex flex-col md:flex-row max-h-[90vh]">
            
            {/* Close Button */}
            <button
              onClick={() => setActiveImageIndex(null)}
              className="absolute right-4 top-4 z-20 p-2 text-zinc-400 hover:text-white rounded-full bg-zinc-900/60 hover:bg-zinc-800/60 border border-zinc-800 transition duration-200 cursor-pointer"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Left compartment: Enlarged Image & Navigation */}
            <div className="relative flex-1 bg-zinc-950 flex items-center justify-center p-4 min-h-[300px] md:min-h-[450px]">
              <img
                src={activeImage['image-url']}
                alt={getFilename(activeImage['image-url'])}
                className="max-w-full max-h-[70vh] object-contain rounded"
              />

              {/* Prev image control */}
              {activeImageIndex !== null && activeImageIndex > 0 && (
                <button
                  onClick={() => openLightbox(activeImageIndex - 1)}
                  className="absolute left-4 p-2 bg-zinc-900/70 hover:bg-zinc-800/70 border border-zinc-800/80 rounded-full text-zinc-400 hover:text-white transition duration-200 cursor-pointer"
                  aria-label="Previous"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
              )}

              {/* Next image control */}
              {activeImageIndex !== null && activeImageIndex < paginatedImages.length - 1 && (
                <button
                  onClick={() => openLightbox(activeImageIndex + 1)}
                  className="absolute right-4 p-2 bg-zinc-900/70 hover:bg-zinc-800/70 border border-zinc-800/80 rounded-full text-zinc-400 hover:text-white transition duration-200 cursor-pointer"
                  aria-label="Next"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Right compartment: Info & WhatsApp Form */}
            <div className="w-full md:w-80 border-t md:border-t-0 md:border-l border-zinc-800 p-6 flex flex-col justify-between bg-[#111116] overflow-y-auto max-h-[50vh] md:max-h-full">
              
              <div>
                <h3 className="text-sm font-bold text-white truncate pr-6" title={getFilename(activeImage['image-url'])}>
                  {getFilename(activeImage['image-url'])}
                </h3>
                
                {/* Meta details list */}
                <div className="mt-4 space-y-3">
                  
                  {/* Status indicator */}
                  <div className="flex items-center justify-between text-xs border-b border-zinc-900 pb-2">
                    <span className="text-zinc-500 font-medium">WhatsApp Status</span>
                    <div>
                      {activeImage.status === 'sent' && (
                        <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-md text-[10px] font-bold uppercase tracking-wider">
                          Sent
                        </span>
                      )}
                      {activeImage.status === 'pending' && (
                        <span className="px-2 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-md text-[10px] font-bold uppercase tracking-wider animate-pulse">
                          Pending
                        </span>
                      )}
                      {activeImage.status === 'failed' && (
                        <span className="px-2 py-0.5 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-md text-[10px] font-bold uppercase tracking-wider">
                          Failed
                        </span>
                      )}
                      {!activeImage.status && (
                        <span className="px-2 py-0.5 bg-zinc-800 text-zinc-400 border border-zinc-700/50 rounded-md text-[10px] font-bold uppercase tracking-wider">
                          Unqueued
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Active target phone */}
                  {activeImage['whatsapp-number'] && (
                    <div className="flex items-center justify-between text-xs border-b border-zinc-900 pb-2">
                      <span className="text-zinc-500 font-medium">Phone Number</span>
                      <span className="font-mono text-zinc-300 font-semibold">{activeImage['whatsapp-number']}</span>
                    </div>
                  )}

                  {/* CDN Link */}
                  <div className="pt-2">
                    <a
                      href={activeImage['image-url']}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-lg text-xs font-semibold text-zinc-300 transition duration-200"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Open CDN Image
                    </a>
                  </div>

                  {/* QR Code sharing container */}
                  <div className="pt-4 flex flex-col items-center justify-center bg-zinc-950/40 border border-zinc-900/60 rounded-lg p-3">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-2">Scan to Share</span>
                    <div className="bg-white p-1.5 rounded-lg border border-zinc-200 shadow-md">
                      <QRCodeSVG
                        value={qrUrl}
                        size={110}
                        level="Q"
                        includeMargin={false}
                        fgColor="#09090b"
                        bgColor="#ffffff"
                      />
                    </div>
                    <span className="text-[9px] text-zinc-500 font-mono mt-2 truncate w-full text-center" title={qrUrl}>
                      {qrUrl}
                    </span>
                  </div>

                </div>
              </div>

              {/* WhatsApp Form Compartment */}
              <div className="mt-8 pt-6 border-t border-zinc-800">
                <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-3 flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-zinc-400" />
                  Send via WhatsApp
                </h4>
                
                <form onSubmit={handleUpdateStatus} className="space-y-3">
                  <div>
                    <input
                      type="text"
                      placeholder="e.g. 94772462795"
                      value={whatsappInput}
                      onChange={(e) => setWhatsappInput(e.target.value)}
                      required
                      className="w-full bg-[#0d0d11] border border-zinc-800 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 rounded-lg px-3 py-2 text-xs text-zinc-200 outline-none font-mono"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isUpdatingStatus || activeImage.status === 'pending'}
                    className="w-full py-2 px-3 bg-violet-600 hover:bg-violet-500 text-white rounded-lg text-xs font-bold transition duration-200 disabled:opacity-50 cursor-pointer"
                  >
                    {isUpdatingStatus ? 'Queueing...' : activeImage.status === 'pending' ? 'Queued Pending' : 'Send'}
                  </button>

                  {/* Feedback response */}
                  {updateMessage && (
                    <div
                      className={`p-2.5 rounded-lg text-center text-xs font-medium mt-2 ${
                        updateMessage.type === 'success'
                          ? 'bg-emerald-950/20 border border-emerald-900/30 text-emerald-400'
                          : 'bg-rose-950/20 border border-rose-900/30 text-rose-400'
                      }`}
                    >
                      {updateMessage.text}
                    </div>
                  )}
                </form>
              </div>

            </div>

          </div>
        </div>
      )}

    </div>
  );
}

'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import Image from 'next/image';
import { RotateCw, Image as ImageIcon, ChevronLeft, ChevronRight, X, QrCode, MessageSquare } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

interface ImageRecord {
  _id: string;
  'image-url': string;
  status?: 'sent' | 'pending' | 'failed' | null;
  'whatsapp-number'?: string;
}

const ITEMS_PER_PAGE = 9; // 3 rows of 3 columns on tablet/desktop (perfect multiple of 3)

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
  const [filter, setFilter] = useState<'unsent' | 'sent'>('unsent');
  
  // WhatsApp Form states inside Modal
  const [whatsappInput, setWhatsappInput] = useState<string>('');
  const [isUpdatingStatus, setIsUpdatingStatus] = useState<boolean>(false);
  const [updateMessage, setUpdateMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [isModalImageLoading, setIsModalImageLoading] = useState<boolean>(true);
  const [isQrPopupOpen, setIsQrPopupOpen] = useState<boolean>(false);

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

  // Filter images based on current filter state
  const filteredImages = useMemo(() => {
    if (filter === 'sent') {
      return images.filter(img => img.status === 'sent');
    } else {
      return images.filter(img => img.status !== 'sent');
    }
  }, [images, filter]);

  // Pagination calculations
  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(filteredImages.length / ITEMS_PER_PAGE));
  }, [filteredImages]);

  // Adjust page number if it exceeds total pages
  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [totalPages, currentPage]);

  const paginatedImages = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredImages.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [filteredImages, currentPage]);

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
    setWhatsappInput(img?.['whatsapp-number'] || '');
    setUpdateMessage(null);
    setIsModalImageLoading(true);
    setIsQrPopupOpen(false); // Reset QR popup state
  };

  // Lightbox keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (activeImageIndex === null) return;
      if (e.key === 'Escape') {
        setActiveImageIndex(null);
        setIsQrPopupOpen(false);
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

  // Realtime phone validation
  const phoneError = useMemo(() => {
    if (!whatsappInput) return null;
    const stripped = whatsappInput.replace(/\s+/g, '');
    if (stripped.length === 0) return null;
    
    if (!stripped.startsWith('0')) {
      return 'Number must start with 0';
    }
    
    if (!/^\d+$/.test(stripped)) {
      return 'Must contain only numbers';
    }
    
    if (stripped.length !== 10) {
      return `Must be exactly 10 digits (currently ${stripped.length})`;
    }
    
    return null;
  }, [whatsappInput]);

  const isSubmitDisabled = useMemo(() => {
    const stripped = whatsappInput.replace(/\s+/g, '');
    return (
      isUpdatingStatus ||
      activeImage?.status === 'pending' ||
      !!phoneError ||
      stripped.length !== 10
    );
  }, [isUpdatingStatus, activeImage, phoneError, whatsappInput]);

  // Submit WhatsApp update & status reset
  const handleUpdateStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeImage) return;

    setIsUpdatingStatus(true);
    setUpdateMessage(null);

    // Format phone number: Strip spaces and replace leading 0 with 94
    let formattedNumber = whatsappInput.replace(/\s+/g, '');
    if (formattedNumber.startsWith('0')) {
      formattedNumber = '94' + formattedNumber.slice(1);
    }

    try {
      const res = await fetch('/api/images', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: activeImage._id,
          phoneNumber: formattedNumber,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setUpdateMessage({ type: 'success', text: 'WhatsApp queued as pending!' });
        setWhatsappInput(formattedNumber); // Update input field to show formatted version
        
        // Update images array optimistically
        setImages((prev) =>
          prev.map((img) =>
            img._id === activeImage._id
              ? { ...img, status: 'pending', 'whatsapp-number': formattedNumber }
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
    <div className="h-svh max-h-svh bg-[#EEE8E0] text-[#2C2520] font-sans antialiased selection:bg-[#AE7FD2]/30 selection:text-[#9A69BD] flex flex-col justify-between overflow-hidden relative">
      
      {/* Background Flowers */}
      <div className="absolute inset-4 sm:inset-6 pointer-events-none z-0">
        {/* Corner Flowers */}
        <img src="/images/flower-1.png" alt="" style={{ width: '250px', height: '250px', transform: 'rotate(20deg)', top: '-141px', left: '-141px' }} className="absolute object-contain pointer-events-none z-10" />
        <img src="/images/flower-2.png" alt="" style={{ width: '322px', height: '322px', transform: 'rotate(185deg)', top: '-175px', right: '-133px' }} className="absolute object-contain pointer-events-none z-10" />
        <img src="/images/flower-3.png" alt="" style={{ width: '264px', height: '264px', transform: 'rotate(45deg)', bottom: '-144px', left: '-96px' }} className="absolute object-contain pointer-events-none z-10" />
        <img src="/images/flower-4.png" alt="" style={{ width: '260px', height: '260px', transform: 'rotate(320deg)', bottom: '14px', right: '-180px' }} className="absolute object-contain pointer-events-none z-10" />
      </div>

      {/* Main Content Area */}
      <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-2 relative z-10 flex-1 flex flex-col overflow-hidden">
        
        {/* Header & Action controls (Slightly larger fonts & pads for tablets) */}
        <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#AE7FD2]/20 pb-5 mb-5 shrink-0">
          <div>
            <div className="flex items-center gap-3">
              <img src="/images/Lux-Logo-flat.png" alt="LUX Logo" className="w-12 h-auto object-contain brightness-0" />
              <h1 className="font-script text-4xl sm:text-5xl text-[#9A69BD] leading-none tracking-wide pt-2 flex items-center gap-2">
                Gallery
                <span className="flex h-2.5 w-2.5 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#9A69BD] opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#AE7FD2]"></span>
                </span>
              </h1>
            </div>
            <p className="text-sm sm:text-base text-[#2C2520]/70 mt-1">
              Live sync active • Updates every 5 seconds.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 self-start sm:self-auto">
            {/* Filter Buttons */}
            <div className="flex bg-white/50 p-1 rounded-lg border border-[#AE7FD2]/30 shrink-0">
              <button
                onClick={() => { setFilter('unsent'); setCurrentPage(1); }}
                className={`px-5 py-2.5 rounded-md text-sm font-bold transition duration-200 cursor-pointer ${
                  filter === 'unsent' 
                    ? 'bg-white text-[#9A69BD] shadow-sm border border-[#AE7FD2]/20' 
                    : 'text-[#2C2520]/60 hover:text-[#2C2520] hover:bg-white/30'
                }`}
              >
                Unsent
              </button>
              <button
                onClick={() => { setFilter('sent'); setCurrentPage(1); }}
                className={`px-5 py-2.5 rounded-md text-sm font-bold transition duration-200 cursor-pointer ${
                  filter === 'sent' 
                    ? 'bg-[#9A69BD]/10 text-[#9A69BD] border border-[#9A69BD]/30 shadow-sm' 
                    : 'text-[#2C2520]/60 hover:text-[#2C2520] hover:bg-white/30'
                }`}
              >
                Sent
              </button>
            </div>

            {/* Manual Refresh Button (Enlarged) */}
            <button
              onClick={() => fetchImages(false, true)}
              disabled={isRefreshing}
              className="flex items-center justify-center gap-2.5 px-6 py-3.5 bg-white border border-[#AE7FD2]/30 hover:border-[#9A69BD] hover:bg-gray-50 text-[#2C2520] rounded-lg transition duration-200 font-bold text-base disabled:opacity-50 cursor-pointer shrink-0 shadow-sm"
            >
              <RotateCw className={`w-5 h-5 ${isRefreshing ? 'animate-spin text-[#9A69BD]' : ''}`} />
              <span className="hidden sm:inline">{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
            </button>
          </div>
        </header>

        {/* Error Alert */}
        {error && (
          <div className="bg-rose-100 border border-rose-200 rounded-xl p-4 mb-6 text-sm text-rose-700">
            {error}
          </div>
        )}

        {/* Gallery Grid Wrapper (Top-aligned scrollable wrapper) */}
        <div className="flex-1 overflow-y-auto pr-1">
          {isLoading ? (
            /* Loading Skeletons - 3 Columns on tablet/desktop */
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-6">
              {[...Array(9)].map((_, i) => (
                <div key={i} className="aspect-square bg-white/50 border border-[#AE7FD2]/20 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : filteredImages.length === 0 ? (
            
            /* Empty State */
            <div className="bg-white/40 border border-[#AE7FD2]/30 rounded-xl p-16 text-center max-w-lg mx-auto w-full">
              <ImageIcon className="w-12 h-12 text-[#2C2520]/40 mx-auto mb-3" />
              <p className="text-[#2C2520]/60 font-medium">No images found</p>
            </div>
          ) : (
            
            /* Gallery Grid (Fixed 9 items, 3 rows of 3 columns on desktop/tablet, larger gap-6) */
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-6 pb-6">
              {paginatedImages.map((image, index) => {
                const nameStr = getFilename(image['image-url']);
                return (
                  <div
                    key={image._id}
                    onClick={() => openLightbox(index)}
                    className="group relative aspect-square bg-white border border-[#AE7FD2]/30 hover:border-[#9A69BD]/60 rounded-lg overflow-hidden transition duration-300 shadow-sm cursor-pointer"
                  >
                    <Image
                      src={image['image-url']}
                      alt={nameStr}
                      width={400}
                      height={400}
                      className="w-full h-full object-cover transition duration-500 group-hover:scale-105"
                      priority={index < 3} // priority for the first row of 3
                    />
                    
                    {/* Status Dot indicator */}
                    {image.status && (image.status === 'sent' || image.status === 'pending') && (
                      <div className="absolute top-3 right-3">
                        {image.status === 'sent' && (
                          <span className="flex w-2.5 h-2.5 bg-emerald-500 rounded-full shadow-[0_0_6px_#10b981]" />
                        )}
                        {image.status === 'pending' && (
                          <span className="flex w-2.5 h-2.5 bg-amber-500 rounded-full shadow-[0_0_6px_#f59e0b] animate-pulse" />
                        )}
                      </div>
                    )}
                    
                    {/* Subtle hover overlay to showcase filename */}
                    <div className="absolute inset-0 bg-gradient-to-t from-white/90 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition duration-200 flex items-end p-3.5">
                      <span className="text-xs font-medium text-[#2C2520] truncate w-full">
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

      {/* Footer with Pagination (Slightly larger elements for tablets) */}
      <footer className="border-t border-[#AE7FD2]/20 bg-[#EEE8E0]/80 backdrop-blur-md py-5 relative z-10 shrink-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          
          {/* Item Count */}
          <div className="text-base text-[#2C2520]/70">
            Showing <span className="font-semibold text-[#2C2520]">
              {filteredImages.length === 0 ? 0 : (currentPage - 1) * ITEMS_PER_PAGE + 1}
            </span> to <span className="font-semibold text-[#2C2520]">
              {Math.min(currentPage * ITEMS_PER_PAGE, filteredImages.length)}
            </span> of <span className="font-semibold text-[#2C2520]">{filteredImages.length}</span> images
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center gap-3.5">
              {/* Prev Button */}
              <button
                onClick={handlePrevPage}
                disabled={currentPage === 1}
                className="p-3.5 rounded-lg bg-white border border-[#AE7FD2]/30 text-[#2C2520] hover:text-[#9A69BD] hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-[#2C2520] transition duration-200 cursor-pointer shadow-sm"
                aria-label="Previous Page"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>

              {/* Page Numbers */}
              <div className="flex items-center gap-2">
                {[...Array(totalPages)].map((_, i) => {
                  const pageNum = i + 1;
                  return (
                    <button
                      key={pageNum}
                      onClick={() => setCurrentPage(pageNum)}
                      className={`px-6 py-3 rounded-lg text-base font-bold transition duration-150 cursor-pointer shadow-sm ${
                        currentPage === pageNum
                          ? 'bg-[#9A69BD] text-white shadow-[#9A69BD]/30 border border-[#9A69BD]'
                          : 'bg-white border border-[#AE7FD2]/30 text-[#2C2520] hover:text-[#9A69BD] hover:bg-gray-50'
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
                className="p-3.5 rounded-lg bg-white border border-[#AE7FD2]/30 text-[#2C2520] hover:text-[#9A69BD] hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-[#2C2520] transition duration-200 cursor-pointer shadow-sm"
                aria-label="Next Page"
              >
                <ChevronRight className="w-6 h-6" />
              </button>
            </div>
          )}

        </div>
      </footer>

      {/* Lightbox / Modal (Optimized/larger layout container max-w-2xl, stacked vertically) */}
      {activeImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-white/60 backdrop-blur-sm">
          
          {/* Close target */}
          <div className="absolute inset-0" onClick={() => setActiveImageIndex(null)} />

          {/* Modal Container */}
          <div className="relative w-full max-w-2xl bg-white border border-[#AE7FD2]/30 rounded-xl overflow-y-auto shadow-2xl z-10 flex flex-col max-h-[90vh]">
            
            {/* Close Button (Larger touch target) */}
            <button
              onClick={() => setActiveImageIndex(null)}
              className="absolute right-4 top-4 z-20 p-3 text-[#2C2520]/60 hover:text-[#9A69BD] rounded-full bg-white/80 hover:bg-gray-50 border border-[#AE7FD2]/30 shadow-sm transition duration-200 cursor-pointer"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Top compartment: Enlarged Image & Navigation (Preview quality reduced to 50%) */}
            <div className="relative bg-[#EEE8E0]/40 flex items-center justify-center p-6 min-h-[300px] shrink-0 border-b border-[#AE7FD2]/20">
              <Image
                src={activeImage['image-url']}
                alt={getFilename(activeImage['image-url'])}
                width={600}
                height={600}
                quality={50}
                className="max-w-full max-h-[45vh] object-contain rounded drop-shadow-md"
                priority
                onLoad={() => setIsModalImageLoading(false)}
              />

              {/* Loading spinner overlay */}
              {isModalImageLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-[#EEE8E0]/40 backdrop-blur-[1px]">
                  <RotateCw className="w-8 h-8 text-[#9A69BD] animate-spin" />
                </div>
              )}

              {/* Prev image control */}
              {activeImageIndex !== null && activeImageIndex > 0 && (
                <button
                  onClick={() => openLightbox(activeImageIndex - 1)}
                  className="absolute left-4 p-3 bg-white/90 hover:bg-white border border-[#AE7FD2]/30 shadow-sm rounded-full text-[#2C2520]/70 hover:text-[#9A69BD] transition duration-200 cursor-pointer"
                  aria-label="Previous"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
              )}

              {/* Next image control */}
              {activeImageIndex !== null && activeImageIndex < paginatedImages.length - 1 && (
                <button
                  onClick={() => openLightbox(activeImageIndex + 1)}
                  className="absolute right-4 p-3 bg-white/90 hover:bg-white border border-[#AE7FD2]/30 shadow-sm rounded-full text-[#2C2520]/70 hover:text-[#9A69BD] transition duration-200 cursor-pointer"
                  aria-label="Next"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              )}
            </div>

            {/* Bottom compartment: Info & WhatsApp Form (Stacked underneath, text and touch elements enlarged) */}
            <div className="w-full p-8 flex flex-col justify-start bg-white shrink-0">
              
              <div>
                {/* Header Row: Image Name & QR Button (Justify Between) */}
                <div className="flex items-center justify-between gap-4 mb-5 pb-3 border-b border-[#AE7FD2]/20">
                  <h3 className="text-xl font-bold text-[#2C2520] truncate pr-2" title={getFilename(activeImage['image-url'])}>
                    {getFilename(activeImage['image-url'])}
                  </h3>
                  <button
                    onClick={() => setIsQrPopupOpen(true)}
                    className="p-3 bg-white hover:bg-gray-50 border border-[#AE7FD2]/30 hover:border-[#9A69BD] shadow-sm rounded-xl text-[#9A69BD] transition duration-200 cursor-pointer shrink-0"
                    title="Show QR Code"
                  >
                    <QrCode className="w-5.5 h-5.5" />
                  </button>
                </div>
                
                {/* Meta details list (Enlarged) */}
                <div className="space-y-4">
                  
                  {/* Status indicator (Enlarged text-base) */}
                  {(activeImage.status === 'sent' || activeImage.status === 'pending') && (
                    <div className="flex items-center justify-between text-base border-b border-[#AE7FD2]/10 pb-2.5">
                      <span className="text-[#2C2520]/60 font-semibold">WhatsApp Status</span>
                      <div>
                        {activeImage.status === 'sent' && (
                          <span className="px-3 py-1 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded-md text-sm font-bold uppercase tracking-wider shadow-sm">
                            Sent
                          </span>
                        )}
                        {activeImage.status === 'pending' && (
                          <span className="px-3 py-1 bg-amber-50 text-amber-600 border border-amber-200 rounded-md text-sm font-bold uppercase tracking-wider animate-pulse shadow-sm">
                            Not Sent
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Active target phone (Enlarged text-base) */}
                  {activeImage['whatsapp-number'] && (
                    <div className="flex items-center justify-between text-base border-b border-[#AE7FD2]/10 pb-2.5">
                      <span className="text-[#2C2520]/60 font-semibold">Phone Number</span>
                      <span className="font-mono text-[#2C2520] font-bold">{activeImage['whatsapp-number']}</span>
                    </div>
                  )}

                </div>
              </div>

              {/* WhatsApp Form Compartment (Enlarged) */}
              <div className="mt-8">
                <h4 className="text-base font-bold uppercase tracking-wider text-[#2C2520]/70 mb-4 flex items-center gap-2">
                  <MessageSquare className="w-5 h-5 text-[#9A69BD]" />
                  Send via WhatsApp
                </h4>
                
                <form onSubmit={handleUpdateStatus} className="space-y-3.5">
                  <div>
                    <input
                      type="text"
                      placeholder="07X XXX XXXX"
                      value={whatsappInput}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, '').substring(0, 10);
                        setWhatsappInput(val);
                      }}
                      required
                      className="w-full bg-[#EEE8E0]/40 border border-[#AE7FD2]/30 focus:border-[#9A69BD] focus:ring-1 focus:ring-[#9A69BD] rounded-xl px-5 py-4 text-2xl font-bold text-[#2C2520] outline-none font-mono transition duration-200 placeholder:text-[#2C2520]/40 shadow-inner"
                    />
                  </div>

                  {/* Static Helper Info showing the example */}
                  <div className="text-sm text-[#2C2520]/50">
                    Format: <span className="font-semibold text-[#2C2520]/70">07X XXX XXXX</span> (10 digits starting with 0)
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitDisabled}
                    className="w-full py-4.5 px-6 bg-[#9A69BD] hover:bg-[#8e5eb0] active:scale-[0.99] text-white rounded-xl text-lg font-bold transition duration-150 disabled:opacity-50 disabled:bg-[#d4cec6] disabled:text-white disabled:cursor-not-allowed cursor-pointer mt-3 shadow-md shadow-[#9A69BD]/20"
                  >
                    {isUpdatingStatus ? 'Queueing...' : activeImage.status === 'pending' ? 'Queued Pending' : 'Send'}
                  </button>

                  {/* Feedback response */}
                  {updateMessage && (
                    <div
                      className={`p-3.5 rounded-lg text-center text-base font-semibold mt-2 shadow-sm ${
                        updateMessage.type === 'success'
                          ? 'bg-emerald-50 border border-emerald-200 text-emerald-600'
                          : 'bg-rose-50 border border-rose-200 text-rose-600'
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

      {/* QR Code Popup Modal */}
      {isQrPopupOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-white/80 backdrop-blur-md">
          {/* Close target */}
          <div className="absolute inset-0" onClick={() => setIsQrPopupOpen(false)} />
          
          {/* QR Container (just the QR, no texts or anything) */}
          <div className="relative bg-white p-6 rounded-3xl shadow-2xl border border-[#AE7FD2]/30 z-10 flex flex-col items-center">
            {/* Small close X button on top-right */}
            <button
              onClick={() => setIsQrPopupOpen(false)}
              className="absolute -top-12 right-0 text-[#2C2520]/60 hover:text-[#9A69BD] font-bold text-sm flex items-center gap-1 cursor-pointer bg-white/50 px-3 py-1.5 rounded-full border border-[#AE7FD2]/20"
            >
              <X className="w-4 h-4" />
              Close
            </button>

            <QRCodeSVG
              value={qrUrl}
              size={380} // Enlarged popup size
              level="H"
              includeMargin={false}
              fgColor="#2C2520"
              bgColor="#ffffff"
            />
          </div>
        </div>
      )}

    </div>
  );
}

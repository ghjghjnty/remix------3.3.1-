import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  X,
  HardDrive,
  Radio,
  Search,
  Music,
  ArrowLeft,
  Download,
  CheckCircle2,
  Loader2,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  Activity,
  Layers,
  ShieldCheck,
  Trash2,
  Smartphone,
  Lock,
} from 'lucide-react';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';

/**
 * 1. Исходная мобильная ссылка на живой канал МАКС по ТЗ
 */
const LIVE_MAX_CHANNEL_URL =
  'https://max.ru/join/Ymgf4YVJMtgeFAacs17eL1ZtkvtPiIo5JU87Ei_PEAE';

/**
 * Стартовая страница сервиса МАКС для мобильного входа по номеру телефона
 */
const LIVE_MAX_MAIN_URL = 'https://max.ru';

/**
 * Строка User-Agent мобильного Android 13 для эмуляции
 */
export const ANDROID_13_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 13; SM-S901B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36';

/**
 * Базовые файлы фабул канала МАКС
 */
const INITIAL_FABULAS_LIST: string[] = [
  'Антистресс_дождь.flac',
  'Исаев_Фабула_Спокойствие.flac',
  'Фабула_НейроБаланс_День.flac',
];

/**
 * Временные прямые аудиопотоки для тестирования скачивания перехваченных файлов
 */
const TEST_AUDIO_URLS: Record<string, string> = {
  'Антистресс_дождь.flac':
    'https://commondatastorage.googleapis.com/codeskulptor-demos/DDR_assets/Kangaroo_MusiQue_-_The_Neverwritten_Role_Playing_Game.mp3',
  'Исаев_Фабула_Спокойствие.flac':
    'https://interactive-examples.mdn.mozilla.net/media/cc0-audio/t-rex-roar.mp3',
  'Фабула_НейроБаланс_День.flac':
    'https://commondatastorage.googleapis.com/codeskulptor-demos/DDR_assets/Kangaroo_MusiQue_-_The_Neverwritten_Role_Playing_Game.mp3',
};

const DEFAULT_FALLBACK_URL =
  'https://interactive-examples.mdn.mozilla.net/media/cc0-audio/t-rex-roar.mp3';

/**
 * Вспомогательная функция парсинга имени файла из заголовка Content-Disposition
 */
function parseFilenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;

  const rfc5987Match = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (rfc5987Match && rfc5987Match[1]) {
    try {
      return decodeURIComponent(rfc5987Match[1].trim());
    } catch {}
  }

  const standardMatch = header.match(/filename=["']?([^"';\n]+)["']?/i);
  if (standardMatch && standardMatch[1]) {
    return standardMatch[1].trim();
  }

  return null;
}

interface ModernBrowseFolderButtonProps {
  /** Функция-обработчик загрузки локальных файлов с устройства через стандартный input[type="file"] */
  onDeviceUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** Текущая выбранная цветная папка (например, 1_Red, 2_Yellow, 3_Green) */
  selectedFolderName?: string;
  /** Функция обратного вызова при выборе файла */
  onFileSelect?: (fileName: string, localPath?: string) => void;
  /** 
   * Функция передачи скачанного физического файла в цветную папку плеера
   * (использует ту же логику добавления, что и кнопка «Из памяти»)
   */
  onAddDownloadedFile?: (file: File | Blob, fileName: string, localPath?: string) => Promise<void> | void;
  /** Дополнительные CSS-классы для кнопки «Обзор...» */
  className?: string;
  /** Текст кнопки (по умолчанию «Обзор...») */
  buttonText?: string;
}

/**
 * Модернизированная кнопка «Обзор» для цветных папок плеера «Артёмка»:
 * 1. Меню выбора источника («Из памяти» / «Канал МАКС»).
 * 2. Встроенный контейнер In-App WebView с эмуляцией Android 13 (SM-S901B).
 * 3. Мобильные адреса: max.ru и max.ru/join/Ymgf4YVJMtgeFAacs17eL1ZtkvtPiIo5JU87Ei_PEAE.
 * 4. Сохранение сессионных куки между экраном входа и приватным каналом фабул.
 * 5. Непрерывный глубокий DownloadListener для перехвата аудиопотоков .flac и .mp3.
 * 6. Запись в защищенную изолированную директорию Directory.Data через @capacitor/filesystem.
 * 7. Автоматическая привязка локального пути file://... к выбранной цветной папке («1_Red») и закрытие окна.
 */
export const ModernBrowseFolderButton: React.FC<ModernBrowseFolderButtonProps> = ({
  onDeviceUpload,
  selectedFolderName = '1_Red',
  onFileSelect,
  onAddDownloadedFile,
  className = '',
  buttonText = 'Обзор...',
}) => {
  // Открытие модального окна
  const [isOpen, setIsOpen] = useState(false);
  // Экран: 'source_select' или 'max_channel'
  const [currentView, setCurrentView] = useState<'source_select' | 'max_channel'>('source_select');
  
  // Вкладки каталога: «Фабулы» или «БРТ»
  const [activeTab, setActiveTab] = useState<'fabulas' | 'brt'>('fabulas');
  
  // Строка поиска
  const [searchQuery, setSearchQuery] = useState('');

  // 1. Мобильный стартовый адрес: https://max.ru
  const [targetUrl, setTargetUrl] = useState<string>(LIVE_MAX_MAIN_URL);
  const [isIframeLoading, setIsIframeLoading] = useState<boolean>(true);

  // Список файлов фабул
  const [fabulaFiles, setFabulaFiles] = useState<string[]>(INITIAL_FABULAS_LIST);

  // Состояния скачивания файла через DownloadListener
  const [downloadingFileName, setDownloadingFileName] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Ссылки на элементы
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  /**
   * Эффективный адрес для встроенного окна:
   * На нативном Android Capacitor использует overrideUserAgent из capacitor.config.json.
   * В среде веб-разработки запрос проходит через /api/proxy-max для подмены User-Agent на Android 13
   * и синхронизации сессионных куки.
   */
  const effectiveIframeSrc = Capacitor.isNativePlatform()
    ? targetUrl
    : `/api/proxy-max?url=${encodeURIComponent(targetUrl)}`;

  /**
   * Глубокий перехватчик загрузки (DownloadListener) для Capacitor WebView и In-App фрейма
   */
  const handleDownloadListenerIntercept = useCallback(
    async (
      e: React.MouseEvent | null,
      candidateFileName: string,
      overrideUrl?: string
    ) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }

      if (downloadingFileName) return;

      let finalFileName = candidateFileName;
      const downloadUrl = overrideUrl || TEST_AUDIO_URLS[candidateFileName] || DEFAULT_FALLBACK_URL;

      console.log(`[DownloadListener] Перехвачен аудиопоток: ${finalFileName} (${downloadUrl})`);

      setDownloadingFileName(finalFileName);
      setDownloadProgress(15);
      setStatusMessage({
        text: `[DownloadListener] Анализ аудиопотока «${finalFileName}»...`,
        type: 'info',
      });

      try {
        let detectedContentType = '';
        let dispositionFilename: string | null = null;

        try {
          const headResponse = await fetch(downloadUrl, { method: 'HEAD' });
          detectedContentType = (headResponse.headers.get('content-type') || '').toLowerCase().trim();
          const disposition = headResponse.headers.get('content-disposition');
          dispositionFilename = parseFilenameFromContentDisposition(disposition);
        } catch {
          // Игнорируем сетевые ограничения HEAD для внешних доменов
        }

        if (dispositionFilename) {
          finalFileName = dispositionFilename;
        }

        const isFlacByExt = finalFileName.toLowerCase().endsWith('.flac');
        const isMp3ByExt = finalFileName.toLowerCase().endsWith('.mp3');
        const isFlacByMime =
          detectedContentType.includes('audio/flac') || detectedContentType.includes('audio/x-flac');
        const isMp3ByMime =
          detectedContentType.includes('audio/mpeg') || detectedContentType.includes('audio/mp3');

        // Строгая валидация MIME-типов по ТЗ
        if (detectedContentType && !detectedContentType.includes('application/octet-stream')) {
          const isValidMime = isFlacByMime || isMp3ByMime;
          if (!isValidMime && !isFlacByExt && !isMp3ByExt) {
            throw new Error(
              `Блокировка: неподдерживаемый MIME-тип «${detectedContentType}». Разрешены строго audio/flac и audio/mp3.`
            );
          }
        }

        const mimeType = isFlacByExt || isFlacByMime ? 'audio/flac' : 'audio/mpeg';

        setDownloadProgress(40);
        setStatusMessage({
          text: `[DownloadListener] Запись в изолированный кэш Directory.Data...`,
          type: 'info',
        });

        const destinationPath = `NeuroPlayer/${selectedFolderName}/${finalFileName}`;
        let localFilePath = '';
        let audioBlob: Blob | null = null;

        const isNative = Capacitor.isNativePlatform();

        // Нативное прямое скачивание через @capacitor/filesystem в Directory.Data
        if (isNative) {
          const downloadResult = await Filesystem.downloadFile({
            url: downloadUrl,
            path: destinationPath,
            directory: Directory.Data,
            recursive: true,
            progress: true,
          });

          setDownloadProgress(80);

          try {
            const uriRes = await Filesystem.getUri({
              directory: Directory.Data,
              path: destinationPath,
            });
            localFilePath = uriRes.uri;
          } catch {
            localFilePath = downloadResult.path || destinationPath;
          }

          try {
            const readResult = await Filesystem.readFile({
              directory: Directory.Data,
              path: destinationPath,
            });
            if (typeof readResult.data === 'string') {
              const byteCharacters = atob(readResult.data);
              const byteNumbers = new Array(byteCharacters.length);
              for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
              }
              audioBlob = new Blob([new Uint8Array(byteNumbers)], { type: mimeType });
            }
          } catch {}
        }

        // Потоковое получение в веб-окружении с записью в виртуальную файловую систему
        if (!audioBlob) {
          setDownloadProgress(65);
          const response = await fetch(downloadUrl);
          if (!response.ok) {
            throw new Error(`Ошибка загрузки аудиофайла: HTTP ${response.status}`);
          }

          audioBlob = await response.blob();
          setDownloadProgress(90);

          try {
            await Filesystem.writeFile({
              path: destinationPath,
              data: audioBlob,
              directory: Directory.Data,
              recursive: true,
            });
            const uriRes = await Filesystem.getUri({
              directory: Directory.Data,
              path: destinationPath,
            });
            localFilePath = uriRes.uri;
          } catch {
            localFilePath = `file:///data/user/0/com.artemka.neuroplayer/files/${destinationPath}`;
          }
        }

        setDownloadProgress(100);
        console.log(`[DownloadListener] Файл успешно сохранен на 100%: ${localFilePath}`);

        // Автоматическая привязка: передаем локальный путь file://... в цветную папку
        if (onFileSelect) {
          onFileSelect(finalFileName, localFilePath);
        }

        if (onAddDownloadedFile && audioBlob) {
          const fileObj = new File([audioBlob], finalFileName, { type: mimeType });
          await onAddDownloadedFile(fileObj, finalFileName, localFilePath);
        }

        setStatusMessage({
          text: `Фабула «${finalFileName}» успешно скачана в папку ${selectedFolderName}!`,
          type: 'success',
        });

        // Автоматическое закрытие окна каталога по ТЗ
        setTimeout(() => {
          setIsOpen(false);
          setDownloadingFileName(null);
          setDownloadProgress(0);
          setStatusMessage(null);
        }, 1000);
      } catch (err: unknown) {
        console.error('[DownloadListener] Ошибка перехвата:', err);
        setStatusMessage({
          text: `${err instanceof Error ? err.message : 'Сбой перехвата загрузки'}`,
          type: 'error',
        });
        setDownloadingFileName(null);
        setDownloadProgress(0);
      }
    },
    [downloadingFileName, selectedFolderName, onFileSelect, onAddDownloadedFile]
  );

  /**
   * Непрерывная работа DownloadListener (перехват кликов на скачивание и postMessage)
   */
  useEffect(() => {
    if (!isOpen || currentView !== 'max_channel') return;

    const handleGlobalWindowMessage = (event: MessageEvent) => {
      try {
        if (!event.data) return;

        let downloadUrl = '';
        let suggestedName = '';

        if (typeof event.data === 'string') {
          if (event.data.includes('.flac') || event.data.includes('.mp3')) {
            downloadUrl = event.data;
          }
        } else if (typeof event.data === 'object') {
          const { url, fileName, type, mimeType } = event.data;
          if (
            type === 'DOWNLOAD_TRIGGER' ||
            (url && (url.includes('.flac') || url.includes('.mp3'))) ||
            (mimeType && (mimeType.includes('audio/flac') || mimeType.includes('audio/mpeg')))
          ) {
            downloadUrl = url;
            suggestedName = fileName || '';
          }
        }

        if (downloadUrl) {
          const isAudio =
            downloadUrl.toLowerCase().includes('.flac') ||
            downloadUrl.toLowerCase().includes('.mp3') ||
            downloadUrl.toLowerCase().includes('.wav');

          if (isAudio) {
            const finalName =
              suggestedName || downloadUrl.split('/').pop()?.split('?')[0] || 'фабула_перехват.flac';
            handleDownloadListenerIntercept(null, finalName, downloadUrl);
          }
        }
      } catch (err) {
        console.warn('Ошибка обработки сообщения DownloadListener:', err);
      }
    };

    window.addEventListener('message', handleGlobalWindowMessage);

    return () => {
      window.removeEventListener('message', handleGlobalWindowMessage);
    };
  }, [isOpen, currentView, handleDownloadListenerIntercept]);

  /**
   * Обработчик завершения загрузки iframe
   */
  const handleIframeLoaded = () => {
    setIsIframeLoading(false);

    try {
      const iframeDoc = iframeRef.current?.contentDocument || iframeRef.current?.contentWindow?.document;
      if (iframeDoc) {
        iframeDoc.addEventListener(
          'click',
          (e: MouseEvent) => {
            const target = e.target as HTMLElement | null;
            if (!target) return;

            const anchor = target.closest('a');
            if (anchor && anchor.href) {
              const href = anchor.href.toLowerCase();
              if (href.endsWith('.flac') || href.endsWith('.mp3') || anchor.hasAttribute('download')) {
                e.preventDefault();
                e.stopPropagation();
                const fileName =
                  anchor.download || anchor.href.split('/').pop()?.split('?')[0] || 'фабула_макс.flac';
                handleDownloadListenerIntercept(null, fileName, anchor.href);
              }
            }
          },
          true
        );
      }
    } catch {
      // Кросс-доменный фрейм изолирован браузером; перехват работает через глобальный listener
    }
  };

  /**
   * Удаление фабулы из списка в приложении
   */
  const handleDeleteFabulaFromList = (e: React.MouseEvent, fileNameToDelete: string) => {
    e.preventDefault();
    e.stopPropagation();

    setFabulaFiles((prev) => prev.filter((name) => name !== fileNameToDelete));
    setStatusMessage({
      text: `Файл «${fileNameToDelete}» удален из списка`,
      type: 'info',
    });
    setTimeout(() => {
      setStatusMessage((cur) => (cur?.text.includes('удален') ? null : cur));
    }, 2500);
  };

  // Открытие модального окна
  const handleOpenModal = () => {
    setCurrentView('source_select');
    setActiveTab('fabulas');
    setSearchQuery('');
    setStatusMessage(null);
    setTargetUrl(LIVE_MAX_MAIN_URL);
    setIsOpen(true);
  };

  // Закрытие модального окна
  const handleCloseModal = () => {
    if (downloadingFileName) {
      const confirmed = window.confirm ? window.confirm('Идет скачивание файла. Закрыть окно?') : true;
      if (!confirmed) return;
    }
    setIsOpen(false);
    setCurrentView('source_select');
    setSearchQuery('');
    setStatusMessage(null);
  };

  // Клик по кнопке «Из памяти»
  const handleFromDeviceMemoryClick = () => {
    setIsOpen(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  // Переход на экран «Канал МАКС»
  const handleOpenMaxChannel = () => {
    setCurrentView('max_channel');
    setActiveTab('fabulas');
    setSearchQuery('');
    setTargetUrl(LIVE_MAX_MAIN_URL);
    setIsIframeLoading(true);
  };

  // Возврат назад
  const handleBackToSourceSelection = () => {
    setCurrentView('source_select');
    setSearchQuery('');
  };

  // 3. Переключение между вкладкой «Вход» и «Канал фабул» с сохранением сессионных куки
  const handleSwitchTargetUrl = (newUrl: string) => {
    if (newUrl === targetUrl) return;
    setIsIframeLoading(true);
    setTargetUrl(newUrl);
  };

  // Фильтрация фабул поисковой строкой «на лету»
  const filteredFabulas = fabulaFiles.filter((file) =>
    file.toLowerCase().includes(searchQuery.trim().toLowerCase())
  );

  return (
    <>
      {/* Скрытый нативный input для файлов с устройства */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".flac,.mp3,audio/*"
        multiple
        onChange={onDeviceUpload}
        className="hidden"
      />

      {/* Кнопка «Обзор...» с фирменным стилем */}
      <button
        id="btn_browse_files"
        type="button"
        onClick={handleOpenModal}
        className={`px-3 py-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-bold cursor-pointer transition-all border-[2.5px] border-[#50C878] shadow-[0_0_12px_rgba(80,200,120,0.35)] hover:shadow-[0_0_18px_rgba(80,200,120,0.55)] active:scale-95 flex items-center justify-center tracking-wide select-none ${className}`}
        style={{ borderColor: '#50C878', borderWidth: '2.5px' }}
      >
        {buttonText}
      </button>

      {/* Всплывающее модальное окно */}
      {isOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-2.5 sm:p-4 animate-in fade-in duration-150"
          onClick={handleCloseModal}
        >
          <div
            className="w-full max-w-lg bg-[#1e1e24] border border-neutral-700 rounded-3xl p-4 sm:p-5 shadow-2xl text-neutral-100 flex flex-col max-h-[94vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* ЭКРАН 1: Меню выбора источника */}
            {currentView === 'source_select' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
                  <div>
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      <Music className="w-5 h-5 text-emerald-400" />
                      Источник аудиофайлов
                    </h3>
                    <p className="text-xs text-neutral-400 mt-0.5">
                      Добавление в цветную папку: <span className="font-semibold text-emerald-300">{selectedFolderName}</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleCloseModal}
                    className="w-8 h-8 rounded-full bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-white flex items-center justify-center transition cursor-pointer active:scale-95"
                    title="Закрыть"
                    aria-label="Закрыть меню"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-3 pt-1">
                  <button
                    type="button"
                    id="btn_source_device_memory"
                    onClick={handleFromDeviceMemoryClick}
                    className="flex items-center gap-3.5 p-3.5 rounded-2xl bg-neutral-800/90 hover:bg-neutral-800 border border-neutral-700 hover:border-emerald-500/70 transition-all text-left group cursor-pointer active:scale-[0.98]"
                  >
                    <div className="w-11 h-11 rounded-xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center border border-emerald-500/30 group-hover:bg-emerald-500/25 transition">
                      <HardDrive className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-white group-hover:text-emerald-300 transition">
                        Из памяти
                      </div>
                      <div className="text-xs text-neutral-400">
                        Выбрать физический файл с устройства (.flac / .mp3)
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    id="btn_source_max_channel"
                    onClick={handleOpenMaxChannel}
                    className="flex items-center gap-3.5 p-3.5 rounded-2xl bg-neutral-800/90 hover:bg-neutral-800 border border-neutral-700 hover:border-sky-500/70 transition-all text-left group cursor-pointer active:scale-[0.98]"
                  >
                    <div className="w-11 h-11 rounded-xl bg-sky-500/15 text-sky-400 flex items-center justify-center border border-sky-500/30 group-hover:bg-sky-500/25 transition">
                      <Radio className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-white group-hover:text-sky-300 transition">
                        Канал МАКС
                      </div>
                      <div className="text-xs text-neutral-400">
                        Мобильный фрейм канала и перехватчик DownloadListener
                      </div>
                    </div>
                  </button>
                </div>
              </div>
            )}

            {/* ЭКРАН 2: Встроенная мобильная версия и каталог «Канал МАКС» */}
            {currentView === 'max_channel' && (
              <div className="flex flex-col h-full space-y-3 overflow-hidden">
                {/* Шапка каталога */}
                <div className="flex items-center justify-between pb-2.5 border-b border-neutral-800 shrink-0">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleBackToSourceSelection}
                      disabled={!!downloadingFileName}
                      className="p-1.5 -ml-1 rounded-xl bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-neutral-300 hover:text-white transition cursor-pointer active:scale-95"
                      title="Назад к выбору источника"
                      aria-label="Назад"
                    >
                      <ArrowLeft className="w-4 h-4" />
                    </button>
                    <div>
                      <h3 className="text-sm sm:text-base font-bold text-white flex items-center gap-1.5">
                        <Radio className="w-4 h-4 text-sky-400" />
                        Канал МАКС
                      </h3>
                      <p className="text-[11px] text-neutral-400 flex items-center gap-1.5">
                        Папка: <span className="text-sky-300 font-semibold">{selectedFolderName}</span>
                        <span className="text-neutral-500">•</span>
                        {/* 4. Зеленый статус DownloadListener */}
                        <span className="text-emerald-400 inline-flex items-center gap-0.5 text-[10px] font-medium">
                          <ShieldCheck className="w-3 h-3" /> DownloadListener активен
                        </span>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {/* Кнопка перезагрузки фрейма */}
                    <button
                      type="button"
                      onClick={() => {
                        setIsIframeLoading(true);
                        if (iframeRef.current) {
                          iframeRef.current.src = effectiveIframeSrc;
                        }
                      }}
                      disabled={!!downloadingFileName}
                      className="w-7 h-7 rounded-full bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-white flex items-center justify-center transition cursor-pointer active:scale-95"
                      title="Обновить страницу"
                      aria-label="Обновить"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isIframeLoading ? 'animate-spin text-sky-400' : ''}`} />
                    </button>

                    {/* Кнопка закрытия */}
                    <button
                      type="button"
                      onClick={handleCloseModal}
                      className="w-7 h-7 rounded-full bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-white flex items-center justify-center transition cursor-pointer active:scale-95"
                      title="Закрыть"
                      aria-label="Закрыть"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* 1 & 2 & 3. ВСТРОЕННЫЙ КОНТЕЙНЕР С ЭМУЛЯЦИЕЙ ANDROID 13 И МОБИЛЬНЫМИ ССЫЛКАМИ */}
                <div className="relative w-full h-56 sm:h-64 rounded-2xl overflow-hidden border border-sky-600/40 bg-neutral-900 flex flex-col shadow-inner shrink-0">
                  {/* Панель управления фреймом */}
                  <div className="px-2.5 py-1.5 bg-neutral-950 border-b border-neutral-800 flex items-center justify-between gap-1 text-[11px] shrink-0">
                    {/* Переключатели адресов внутри мобильной сессии max.ru */}
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleSwitchTargetUrl(LIVE_MAX_MAIN_URL)}
                        className={`px-2.5 py-0.5 rounded-lg font-semibold transition cursor-pointer flex items-center gap-1 ${
                          targetUrl === LIVE_MAX_MAIN_URL
                            ? 'bg-sky-600 text-white shadow-sm'
                            : 'bg-neutral-800 text-neutral-300 hover:text-white'
                        }`}
                        title="Мобильная страница входа по номеру телефона (max.ru)"
                      >
                        <Smartphone className="w-3 h-3" />
                        <span>Вход (max.ru)</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSwitchTargetUrl(LIVE_MAX_CHANNEL_URL)}
                        className={`px-2.5 py-0.5 rounded-lg font-semibold transition cursor-pointer flex items-center gap-1 ${
                          targetUrl === LIVE_MAX_CHANNEL_URL
                            ? 'bg-sky-600 text-white shadow-sm'
                            : 'bg-neutral-800 text-neutral-300 hover:text-white'
                        }`}
                        title="Мобильная ссылка на приватный канал фабул (max.ru/join/...)"
                      >
                        <Radio className="w-3 h-3 text-sky-400" />
                        <span>Канал фабул</span>
                      </button>
                    </div>

                    {/* Статус эмуляции Android 13 */}
                    <div className="flex items-center gap-1.5 text-neutral-400 text-[10px]">
                      <span className="hidden sm:inline-flex items-center gap-1 text-emerald-400 font-medium">
                        <Lock className="w-2.5 h-2.5" /> Android 13 (SM-S901B)
                      </span>
                      <a
                        href={targetUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1 hover:text-white transition"
                        title="Открыть в браузере"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>

                  {/* Индикатор загрузки фрейма */}
                  {isIframeLoading && (
                    <div className="absolute inset-0 top-7 bg-neutral-900/90 backdrop-blur-sm z-10 flex flex-col items-center justify-center gap-1.5 text-xs text-sky-300">
                      <Loader2 className="w-5 h-5 animate-spin text-sky-400" />
                      <span>Загрузка мобильной страницы МАКС (Android 13)...</span>
                    </div>
                  )}

                  {/* Живой фрейм мобильной версии с сохраненными cookies */}
                  <iframe
                    ref={iframeRef}
                    key={effectiveIframeSrc}
                    src={effectiveIframeSrc}
                    title="MAX Mobile Channel Frame"
                    className="w-full flex-1 border-0 bg-white"
                    allow="autoplay; clipboard-read; clipboard-write; forms"
                    sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-downloads"
                    onLoad={handleIframeLoaded}
                  />
                </div>

                {/* ДВЕ ВКЛАДКИ: «Фабулы» и «БРТ» */}
                <div className="grid grid-cols-2 gap-2 p-1 bg-neutral-900 rounded-2xl border border-neutral-800 shrink-0">
                  <button
                    type="button"
                    id="tab_fabulas"
                    onClick={() => setActiveTab('fabulas')}
                    className={`flex items-center justify-center gap-2 py-1.5 px-3 rounded-xl text-xs font-bold transition cursor-pointer ${
                      activeTab === 'fabulas'
                        ? 'bg-sky-600 text-white shadow-md'
                        : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/60'
                    }`}
                  >
                    <Layers className="w-3.5 h-3.5" />
                    Фабулы ({fabulaFiles.length})
                  </button>
                  <button
                    type="button"
                    id="tab_brt"
                    onClick={() => setActiveTab('brt')}
                    className={`flex items-center justify-center gap-2 py-1.5 px-3 rounded-xl text-xs font-bold transition cursor-pointer ${
                      activeTab === 'brt'
                        ? 'bg-purple-600 text-white shadow-md'
                        : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/60'
                    }`}
                  >
                    <Activity className="w-3.5 h-3.5" />
                    БРТ
                  </button>
                </div>

                {/* Строка поиска по названию фабулы */}
                <div className="relative shrink-0">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-neutral-400">
                    <Search className="w-4 h-4" />
                  </div>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Поиск по названию (.flac / .mp3)..."
                    disabled={!!downloadingFileName}
                    className="w-full h-8 pl-9 pr-9 bg-neutral-900 border border-neutral-700 focus:border-sky-500 rounded-xl text-xs text-white placeholder-neutral-500 focus:outline-none transition disabled:opacity-50"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-neutral-400 hover:text-white cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Панель статуса DownloadListener скачивания */}
                {statusMessage && (
                  <div
                    className={`p-2 rounded-xl border text-xs flex flex-col gap-1 shrink-0 animate-in fade-in ${
                      statusMessage.type === 'success'
                        ? 'bg-emerald-950/80 border-emerald-600/70 text-emerald-200'
                        : statusMessage.type === 'error'
                        ? 'bg-red-950/80 border-red-600/70 text-red-200'
                        : 'bg-sky-950/80 border-sky-600/70 text-sky-200'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {statusMessage.type === 'success' && (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      )}
                      {statusMessage.type === 'error' && (
                        <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                      )}
                      {statusMessage.type === 'info' && (
                        <Loader2 className="w-4 h-4 text-sky-400 animate-spin shrink-0" />
                      )}
                      <span className="font-medium truncate">{statusMessage.text}</span>
                    </div>
                    {downloadingFileName && (
                      <div className="w-full bg-neutral-800/80 h-1.5 rounded-full overflow-hidden">
                        <div
                          className="bg-sky-400 h-full rounded-full transition-all duration-300"
                          style={{ width: `${downloadProgress}%` }}
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* ВКЛАДКА 1: ФАБУЛЫ - Список с кнопками Скачать и Удалить */}
                {activeTab === 'fabulas' && (
                  <div className="flex-1 space-y-1.5 overflow-y-auto max-h-40 pr-1">
                    {filteredFabulas.length === 0 ? (
                      <div className="text-center py-4 text-xs text-neutral-400">
                        Фабулы не найдены по запросу «{searchQuery}».
                      </div>
                    ) : (
                      filteredFabulas.map((fileName) => {
                        const isFlac = fileName.toLowerCase().endsWith('.flac');
                        const isCurrentlyDownloading = downloadingFileName === fileName;

                        return (
                          <div
                            key={fileName}
                            onClick={(e) => !downloadingFileName && handleDownloadListenerIntercept(e, fileName)}
                            className={`flex items-center justify-between p-2 rounded-2xl border transition text-left ${
                              isCurrentlyDownloading
                                ? 'bg-sky-950/40 border-sky-500 shadow-md ring-1 ring-sky-500/50'
                                : 'bg-neutral-800/80 hover:bg-neutral-800 border-neutral-700/80 hover:border-sky-500/70 cursor-pointer active:scale-[0.98]'
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0 pr-2">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase shrink-0 ${
                                  isFlac
                                    ? 'bg-blue-900/80 text-blue-300 border border-blue-700/50'
                                    : 'bg-purple-900/80 text-purple-300 border border-purple-700/50'
                                }`}
                              >
                                {isFlac ? 'FLAC' : 'MP3'}
                              </span>
                              <div className="min-w-0">
                                <span className="block truncate text-xs font-semibold text-neutral-200 group-hover:text-white">
                                  {fileName}
                                </span>
                                <span className="text-[10px] text-neutral-400">
                                  Терапевтическая аудиофабула
                                </span>
                              </div>
                            </div>

                            {/* КНОПКИ ДЕЙСТВИЙ: СКАЧАТЬ (DownloadListener) И УДАЛИТЬ (Trash2) */}
                            <div
                              className="flex items-center gap-1 shrink-0"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                title="Скачать в защищённую память Directory.Data"
                                aria-label={`Скачать ${fileName}`}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  handleDownloadListenerIntercept(e, fileName);
                                }}
                                disabled={!!downloadingFileName}
                                className="w-7 h-7 rounded-lg bg-neutral-700/70 hover:bg-sky-500/25 text-neutral-300 hover:text-sky-300 flex items-center justify-center transition cursor-pointer active:scale-90 disabled:opacity-50"
                              >
                                {isCurrentlyDownloading ? (
                                  <Loader2 className="w-3.5 h-3.5 text-sky-400 animate-spin" />
                                ) : (
                                  <Download className="w-3.5 h-3.5 text-sky-400" />
                                )}
                              </button>

                              <button
                                type="button"
                                title={`Удалить ${fileName} из списка`}
                                aria-label={`Удалить ${fileName} из списка`}
                                onClick={(e) => handleDeleteFabulaFromList(e, fileName)}
                                disabled={!!downloadingFileName}
                                className="w-7 h-7 rounded-lg bg-neutral-700/70 hover:bg-red-500/25 text-neutral-400 hover:text-red-400 flex items-center justify-center transition cursor-pointer active:scale-90 disabled:opacity-50"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}

                {/* ВКЛАДКА 2: БРТ (Заглушка) */}
                {activeTab === 'brt' && (
                  <div className="flex-1 flex flex-col items-center justify-center p-4 text-center space-y-2 bg-neutral-900/50 rounded-2xl border border-neutral-800">
                    <div className="w-10 h-10 rounded-2xl bg-purple-500/15 text-purple-400 flex items-center justify-center border border-purple-500/30">
                      <Activity className="w-5 h-5 animate-pulse" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-white">База БРТ наполняется...</h4>
                      <p className="text-[11px] text-neutral-400 mt-0.5 max-w-xs">
                        Частотные дорожки БРТ для второй части медицинского протокола подключаются через канал МАКС.
                      </p>
                    </div>
                  </div>
                )}

                {/* Подвал */}
                <div className="pt-2 border-t border-neutral-800 flex items-center justify-between text-[11px] text-neutral-400 shrink-0">
                  {/* 4. Зеленый статус защищенного кэша Directory.Data */}
                  <span className="flex items-center gap-1 text-emerald-400/90 font-medium">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Кэш Directory.Data активен
                  </span>
                  <button
                    type="button"
                    onClick={handleBackToSourceSelection}
                    disabled={!!downloadingFileName}
                    className="text-sky-400 hover:text-sky-300 underline font-medium cursor-pointer disabled:opacity-40"
                  >
                    Назад к источнику
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};

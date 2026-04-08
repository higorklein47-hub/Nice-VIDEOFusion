import * as React from 'react';
import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Upload, 
  Plus, 
  Trash2, 
  Play, 
  Download, 
  Settings2, 
  Scissors, 
  Layers,
  Loader2,
  CheckCircle2,
  AlertCircle,
  X,
  ChevronUp,
  ChevronDown,
  Eye,
  FolderPlus,
  FolderOpen,
  GripVertical,
  ArrowRightLeft,
  Package,
  ListOrdered,
  Ban
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Toaster } from '@/components/ui/sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { getFFmpeg, getFileDuration, generateThumbnail, terminateFFmpeg } from '@/src/lib/ffmpeg';
import { VideoFile, VideoGroup, ProcessingOptions, OutputFormat, Resolution, Quality, TransitionType } from '@/src/types';
import { fetchFile } from '@ffmpeg/util';

export default function App() {
  const [videos, setVideos] = useState<VideoFile[]>([]);
  const [groups, setGroups] = useState<VideoGroup[]>([
    { id: 'default', name: 'Grupo Principal', videoIds: [] }
  ]);
  const [activeGroupId, setActiveGroupId] = useState<string>('default');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [options, setOptions] = useState<ProcessingOptions>({
    format: 'mp4',
    resolution: 'original',
    quality: 'medium',
    transition: 'none',
    transitionDuration: 1
  });
  const [resultUrls, setResultUrls] = useState<{ name: string, url: string }[]>([]);
  const [previewInfo, setPreviewInfo] = useState<{ id: string, time: number, url: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (videos.length + files.length > 20) {
      toast.error('Limite máximo de 20 vídeos atingido.');
      return;
    }

    const newVideos: VideoFile[] = [];
    const newVideoIds: string[] = [];
    for (const file of files) {
      const duration = await getFileDuration(file);
      const thumbnail = await generateThumbnail(file);
      const id = Math.random().toString(36).substr(2, 9);
      newVideos.push({
        id,
        file,
        name: file.name,
        duration,
        startTime: 0,
        endTime: duration,
        thumbnail
      });
      newVideoIds.push(id);
    }

    setVideos(prev => [...prev, ...newVideos]);
    setGroups(prev => prev.map(g => 
      g.id === activeGroupId ? { ...g, videoIds: [...g.videoIds, ...newVideoIds] } : g
    ));
    
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const createGroup = () => {
    const newGroup: VideoGroup = {
      id: Math.random().toString(36).substr(2, 9),
      name: `Grupo ${groups.length + 1}`,
      videoIds: []
    };
    setGroups(prev => [...prev, newGroup]);
    setActiveGroupId(newGroup.id);
    toast.success('Novo grupo criado!');
  };

  const removeGroup = (groupId: string) => {
    if (groups.length === 1) return;
    const groupToRemove = groups.find(g => g.id === groupId);
    if (!groupToRemove) return;

    const targetGroupId = groups[0].id === groupId ? groups[1].id : groups[0].id;
    
    setGroups(prev => prev
      .filter(g => g.id !== groupId)
      .map(g => g.id === targetGroupId ? { ...g, videoIds: [...g.videoIds, ...groupToRemove.videoIds] } : g)
    );
    if (activeGroupId === groupId) setActiveGroupId(targetGroupId);
  };

  const removeVideo = (id: string, groupId: string) => {
    setVideos(prev => prev.filter(v => v.id !== id));
    setGroups(prev => prev.map(g => ({
      ...g,
      videoIds: g.videoIds.filter(vid => vid !== id)
    })));
  };

  const moveVideo = (groupId: string, index: number, direction: 'up' | 'down') => {
    setGroups(prev => prev.map(g => {
      if (g.id !== groupId) return g;
      const newVideoIds = [...g.videoIds];
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= newVideoIds.length) return g;
      [newVideoIds[index], newVideoIds[targetIndex]] = [newVideoIds[targetIndex], newVideoIds[index]];
      return { ...g, videoIds: newVideoIds };
    }));
  };

  const transferVideo = (videoId: string, fromGroupId: string, toGroupId: string) => {
    setGroups(prev => prev.map(g => {
      if (g.id === fromGroupId) return { ...g, videoIds: g.videoIds.filter(id => id !== videoId) };
      if (g.id === toGroupId) return { ...g, videoIds: [...g.videoIds, videoId] };
      return g;
    }));
  };

  const updateTrim = (id: string, values: [number, number]) => {
    setVideos(prev => prev.map(v => 
      v.id === id ? { ...v, startTime: values[0], endTime: values[1] } : v
    ));
    
    const video = videos.find(v => v.id === id);
    if (video) {
      setPreviewInfo({ id, time: values[1], url: URL.createObjectURL(video.file) });
    }
  };

  useEffect(() => {
    if (previewVideoRef.current && previewInfo) {
      previewVideoRef.current.currentTime = previewInfo.time;
    }
  }, [previewInfo]);

  const cancelProcessing = () => {
    terminateFFmpeg();
    setIsProcessing(false);
    setProgress(0);
    setStatusMessage('Processamento cancelado.');
    toast.info('Processamento cancelado pelo usuário.');
  };

  const processGroup = async (groupId: string, mode: 'merge' | 'batch') => {
    const group = groups.find(g => g.id === groupId);
    if (!group || group.videoIds.length === 0) {
      toast.error('O grupo está vazio.');
      return;
    }

    setIsProcessing(true);
    setProgress(0);
    setResultUrls([]);
    setStatusMessage('Carregando motor de vídeo...');

    try {
      const ffmpeg = await getFFmpeg();
      setStatusMessage('Preparando arquivos...');
      
      const groupVideos = group.videoIds.map(id => videos.find(v => v.id === id)!).filter(Boolean);
      const results: { name: string, url: string }[] = [];

      // Helper to update progress based on current step
      const updateGlobalProgress = (step: number, totalSteps: number, stepProgress: number) => {
        const base = (step / totalSteps) * 100;
        const current = (stepProgress / totalSteps);
        const total = Math.min(99, Math.round(base + current));
        setProgress(total);
      };

      if (mode === 'batch') {
        const totalSteps = groupVideos.length;
        for (let i = 0; i < groupVideos.length; i++) {
          const v = groupVideos[i];
          setStatusMessage(`Vídeo ${i + 1}/${totalSteps}: ${v.name}`);
          
          const inputName = `input_${i}.mp4`;
          const outputName = `output_${i}.${options.format}`;
          
          await ffmpeg.writeFile(inputName, await fetchFile(v.file));
          
          const resMap = { 'original': '', '1080p': 'scale=1920:1080', '720p': 'scale=1280:720', '480p': 'scale=854:480' };
          const vf = options.resolution !== 'original' ? resMap[options.resolution] : 'scale=trunc(iw/2)*2:trunc(ih/2)*2';

          const progressHandler = ({ progress: p }: { progress: number }) => {
            updateGlobalProgress(i, totalSteps, p * 100);
          };
          ffmpeg.on('progress', progressHandler);

          try {
            await ffmpeg.exec([
              '-ss', v.startTime.toString(),
              '-to', v.endTime.toString(),
              '-i', inputName,
              '-vf', vf,
              '-preset', 'ultrafast',
              outputName
            ]);
          } finally {
            ffmpeg.off('progress', progressHandler);
          }

          const data = await ffmpeg.readFile(outputName);
          results.push({
            name: `${v.name.split('.')[0]}_processed.${options.format}`,
            url: URL.createObjectURL(new Blob([(data as Uint8Array).buffer], { type: `video/${options.format}` }))
          });
          
          await ffmpeg.deleteFile(inputName);
          await ffmpeg.deleteFile(outputName);
        }
      } else {
        // Sequential Merge
        const totalSteps = groupVideos.length + 1;
        const inputNames: string[] = [];
        
        for (let i = 0; i < groupVideos.length; i++) {
          const v = groupVideos[i];
          setStatusMessage(`Parte ${i + 1}/${groupVideos.length}: ${v.name}`);
          
          const inputName = `input_${i}.mp4`;
          const trimmedName = `trimmed_${i}.mp4`;
          await ffmpeg.writeFile(inputName, await fetchFile(v.file));
          
          const resMap = { 'original': '', '1080p': 'scale=1920:1080', '720p': 'scale=1280:720', '480p': 'scale=854:480' };
          const vf = options.resolution !== 'original' ? resMap[options.resolution] : 'scale=trunc(iw/2)*2:trunc(ih/2)*2';

          const progressHandler = ({ progress: p }: { progress: number }) => {
            updateGlobalProgress(i, totalSteps, p * 100);
          };
          ffmpeg.on('progress', progressHandler);

          try {
            await ffmpeg.exec([
              '-ss', v.startTime.toString(),
              '-to', v.endTime.toString(),
              '-i', inputName,
              '-vf', vf,
              '-r', '30',
              '-c:v', 'libx264',
              '-preset', 'ultrafast',
              '-crf', '23',
              '-c:a', 'aac',
              '-ar', '44100',
              trimmedName
            ]);
          } finally {
            ffmpeg.off('progress', progressHandler);
          }
          
          inputNames.push(trimmedName);
          await ffmpeg.deleteFile(inputName);
        }

        setStatusMessage('Finalizando: Mesclando tudo...');
        const outputName = `merged_${groupId}.${options.format}`;
        
        const finalProgressHandler = ({ progress: p }: { progress: number }) => {
          updateGlobalProgress(groupVideos.length, totalSteps, p * 100);
        };
        ffmpeg.on('progress', finalProgressHandler);

        try {
          if (options.transition === 'none' || groupVideos.length === 1) {
            let concatContent = '';
            inputNames.forEach(name => concatContent += `file ${name}\n`);
            await ffmpeg.writeFile('concat.txt', concatContent);
            await ffmpeg.exec(['-f', 'concat', '-safe', '0', '-i', 'concat.txt', '-c', 'copy', outputName]);
          } else {
            let filter = '';
            for(let i=0; i<inputNames.length; i++) {
              filter += `[${i}:v]settb=AVTB,setpts=PTS-STARTPTS[v${i}];`;
              filter += `[${i}:a]asetpts=PTS-STARTPTS[a${i}];`;
            }
            let currentV = '[v0]';
            let currentA = '[a0]';
            let offset = groupVideos[0].endTime - groupVideos[0].startTime - options.transitionDuration;
            for (let i = 1; i < inputNames.length; i++) {
              const nextV = `[v${i}]`, nextA = `[a${i}]`, outV = `[v_out${i}]`, outA = `[a_out${i}]`;
              filter += `${currentV}${nextV}xfade=transition=${options.transition}:duration=${options.transitionDuration}:offset=${offset}${outV};`;
              filter += `${currentA}${nextA}acrossfade=d=${options.transitionDuration}${outA};`;
              currentV = outV; currentA = outA;
              offset = offset + (groupVideos[i].endTime - groupVideos[i].startTime) - options.transitionDuration;
            }
            await ffmpeg.exec([...inputNames.flatMap(name => ['-i', name]), '-filter_complex', filter.slice(0, -1), '-map', currentV, '-map', currentA, '-preset', 'veryfast', outputName]);
          }
        } finally {
          ffmpeg.off('progress', finalProgressHandler);
        }

        const data = await ffmpeg.readFile(outputName);
        results.push({
          name: `${group.name}_final.${options.format}`,
          url: URL.createObjectURL(new Blob([(data as Uint8Array).buffer], { type: `video/${options.format}` }))
        });

        for (const name of inputNames) {
          await ffmpeg.deleteFile(name);
        }
        await ffmpeg.deleteFile(outputName);
      }

      setResultUrls(results);
      setProgress(100);
      setStatusMessage('Processamento concluído com sucesso!');
      toast.success('Processamento concluído!');
    } catch (error) {
      console.error(error);
      if (isProcessing) { // Only show error if not manually cancelled
        toast.error('Erro no processamento. Tente novamente.');
        setStatusMessage('Erro no processamento.');
      }
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-zinc-100 font-sans selection:bg-orange-500/30">
      <div className="max-w-7xl mx-auto px-6 py-12">
        <motion.header 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12"
        >
          <div>
            <h1 className="text-4xl font-bold tracking-tight text-white mb-2 flex items-center gap-3">
              <Layers className="w-10 h-10 text-orange-500" />
              <motion.span
                initial={{ opacity: 0.8 }}
                animate={{ 
                  opacity: [0.8, 1, 0.8],
                  textShadow: ["0 0 10px rgba(249, 115, 22, 0.2)", "0 0 20px rgba(249, 115, 22, 0.5)", "0 0 10px rgba(249, 115, 22, 0.2)"]
                }}
                transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                className="relative"
              >
                Nice-VideoFusion
              </motion.span>
            </h1>
            <p className="text-zinc-400 max-w-xl">
              Organize em grupos e processe seus vídeos em lote ou sequencialmente.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button 
              variant="outline" 
              className="border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800 text-zinc-300"
              onClick={createGroup}
            >
              <FolderPlus className="w-4 h-4 mr-2" />
              Novo Grupo
            </Button>
            <Button 
              className="bg-orange-600 hover:bg-orange-500 text-white"
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
            >
              <Plus className="w-4 h-4 mr-2" />
              Adicionar Vídeos
            </Button>
            <input type="file" ref={fileInputRef} onChange={handleFileSelect} multiple accept="video/*" className="hidden" />
          </div>
        </motion.header>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Sidebar: Groups Navigation */}
          <div className="lg:col-span-1 space-y-4">
            <div className="flex items-center justify-between mb-2 px-2">
              <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Seus Grupos</h3>
            </div>
            <div className="space-y-1">
              {groups.map(group => (
                <div key={group.id} className="group relative">
                  <Button
                    variant={activeGroupId === group.id ? 'secondary' : 'ghost'}
                    className={`w-full justify-start text-left h-12 px-4 rounded-xl transition-all ${activeGroupId === group.id ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
                    onClick={() => setActiveGroupId(group.id)}
                  >
                    <FolderOpen className={`w-4 h-4 mr-3 ${activeGroupId === group.id ? 'text-orange-500' : 'text-zinc-600'}`} />
                    <span className="flex-1 truncate">{group.name}</span>
                    <span className="text-[10px] bg-zinc-900 px-2 py-0.5 rounded-full text-zinc-500">
                      {group.videoIds.length}
                    </span>
                  </Button>
                  {groups.length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 h-8 w-8 text-zinc-600 hover:text-red-400"
                      onClick={(e) => { e.stopPropagation(); removeGroup(group.id); }}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Main Content: Videos in Active Group */}
          <div className="lg:col-span-2 space-y-6">
            <AnimatePresence mode="popLayout">
              {groups.find(g => g.id === activeGroupId)?.videoIds.length === 0 ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="border-2 border-dashed border-zinc-800 rounded-2xl p-16 flex flex-col items-center justify-center text-center bg-zinc-900/20"
                >
                  <Package className="w-12 h-12 text-zinc-700 mb-4" />
                  <h3 className="text-lg font-medium text-zinc-400">Este grupo está vazio</h3>
                  <p className="text-sm text-zinc-600 mt-2 mb-6">Adicione vídeos ou mova de outros grupos.</p>
                  <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="border-zinc-800">
                    Importar Vídeos
                  </Button>
                </motion.div>
              ) : (
                <div className="space-y-4">
                  {groups.find(g => g.id === activeGroupId)?.videoIds.map((vid, index) => {
                    const video = videos.find(v => v.id === vid);
                    if (!video) return null;
                    return (
                      <motion.div
                        key={video.id}
                        layout
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="group bg-zinc-900/40 border border-zinc-800/50 rounded-xl overflow-hidden hover:border-zinc-700 transition-colors"
                      >
                        <div className="p-4 flex gap-4">
                          <div className="flex flex-col gap-1 justify-center">
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-zinc-600 hover:text-zinc-200" onClick={() => moveVideo(activeGroupId, index, 'up')} disabled={index === 0}>
                              <ChevronUp className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-zinc-600 hover:text-zinc-200" onClick={() => moveVideo(activeGroupId, index, 'down')} disabled={index === groups.find(g => g.id === activeGroupId)!.videoIds.length - 1}>
                              <ChevronDown className="w-4 h-4" />
                            </Button>
                          </div>

                          <div className="relative w-32 h-20 bg-black rounded-lg overflow-hidden flex-shrink-0 border border-zinc-800">
                            {video.thumbnail && <img src={video.thumbnail} alt="" className="w-full h-full object-cover opacity-80" />}
                            <div className="absolute bottom-1 right-1 bg-black/80 text-[10px] px-1.5 py-0.5 rounded text-zinc-300 font-mono">
                              {Math.floor(video.duration)}s
                            </div>
                          </div>

                          <div className="flex-1 min-w-0 flex flex-col justify-between">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <h4 className="text-sm font-medium text-zinc-200 truncate">{video.name}</h4>
                                <div className="flex items-center gap-2 mt-1">
                                  <Select onValueChange={(toId: string) => transferVideo(video.id, activeGroupId, toId)}>
                                    <SelectTrigger className="h-6 bg-transparent border-none p-0 text-[10px] text-zinc-500 hover:text-orange-400 w-auto gap-1">
                                      <ArrowRightLeft className="w-3 h-3" />
                                      Mover para...
                                    </SelectTrigger>
                                    <SelectContent className="bg-zinc-950 border-zinc-800">
                                      {groups.filter(g => g.id !== activeGroupId).map(g => (
                                        <SelectItem key={g.id} value={g.id} className="text-xs">{g.name}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>
                              <div className="flex items-center gap-1">
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-500 hover:text-orange-400" onClick={() => setPreviewInfo({ id: video.id, time: video.endTime, url: URL.createObjectURL(video.file) })}>
                                  <Eye className="w-4 h-4" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-500 hover:text-red-400" onClick={() => removeVideo(video.id, activeGroupId)}>
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            </div>
                            
                            <div className="space-y-2 mt-2">
                              <div className="flex items-center justify-between text-[10px] text-zinc-500 font-mono">
                                <span>{video.startTime.toFixed(1)}s</span>
                                <span className="text-orange-500/70">{(video.endTime - video.startTime).toFixed(1)}s selecionado</span>
                                <span>{video.endTime.toFixed(1)}s</span>
                              </div>
                              <Slider value={[video.startTime, video.endTime]} max={video.duration} step={0.1} onValueChange={(vals) => updateTrim(video.id, vals as [number, number])} className="py-1" />
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </AnimatePresence>
          </div>

          {/* Sidebar: Controls & Results */}
          <div className="lg:col-span-1 space-y-6">
            {/* Preview Window */}
            <AnimatePresence>
              {previewInfo && (
                <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}>
                  <Card className="bg-zinc-900 border-orange-500/20 overflow-hidden">
                    <div className="relative aspect-video">
                      <video ref={previewVideoRef} src={previewInfo.url} className="w-full h-full object-contain" muted />
                      <div className="absolute top-2 left-2 bg-black/60 px-2 py-1 rounded text-[10px] text-orange-400 font-mono">
                        Frame: {previewInfo.time.toFixed(2)}s
                      </div>
                      <Button variant="ghost" size="icon" className="absolute top-2 right-2 h-6 w-6 bg-black/40 text-white rounded-full" onClick={() => setPreviewInfo(null)}>
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  </Card>
                </motion.div>
              )}
            </AnimatePresence>

            <Card className="bg-zinc-900/40 border-zinc-800/50 backdrop-blur-sm">
              <CardHeader className="pb-4">
                <CardTitle className="text-sm font-semibold flex items-center gap-2 text-zinc-200">
                  <Settings2 className="w-4 h-4 text-orange-500" />
                  Exportação do Grupo
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <label className="text-[10px] text-zinc-500 uppercase font-bold">Formato</label>
                    <Select value={options.format} onValueChange={(v) => setOptions(prev => ({ ...prev, format: v as OutputFormat }))}>
                      <SelectTrigger className="h-8 text-xs bg-zinc-950 border-zinc-800"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-zinc-950 border-zinc-800"><SelectItem value="mp4">MP4</SelectItem><SelectItem value="webm">WebM</SelectItem><SelectItem value="mkv">MKV</SelectItem></SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] text-zinc-500 uppercase font-bold">Qualidade</label>
                    <Select value={options.quality} onValueChange={(v) => setOptions(prev => ({ ...prev, quality: v as Quality }))}>
                      <SelectTrigger className="h-8 text-xs bg-zinc-950 border-zinc-800"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-zinc-950 border-zinc-800"><SelectItem value="high">Alta</SelectItem><SelectItem value="medium">Média</SelectItem><SelectItem value="low">Baixa</SelectItem></SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] text-zinc-500 uppercase font-bold">Transição (Merge)</label>
                  <Select value={options.transition} onValueChange={(v) => setOptions(prev => ({ ...prev, transition: v as TransitionType }))}>
                    <SelectTrigger className="h-8 text-xs bg-zinc-950 border-zinc-800"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-zinc-950 border-zinc-800">
                      <SelectItem value="none">Nenhuma</SelectItem>
                      <SelectItem value="fade">Fade</SelectItem>
                      <SelectItem value="wipeleft">Wipe</SelectItem>
                      <SelectItem value="slideleft">Slide</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Separator className="bg-zinc-800" />

                {isProcessing ? (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <div className="flex justify-between text-[10px] uppercase font-bold tracking-wider">
                        <span className="text-zinc-500 animate-pulse">{statusMessage || 'Processando...'}</span>
                        <span className="text-orange-500">{progress}%</span>
                      </div>
                      <Progress value={progress} className="h-2 bg-zinc-950 shadow-inner" />
                    </div>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="w-full h-8 text-[10px] text-red-500 hover:text-red-400 hover:bg-red-500/10 border border-red-500/20"
                      onClick={cancelProcessing}
                    >
                      <Ban className="w-3 h-3 mr-2" /> Cancelar Exportação
                    </Button>
                  </div>
                ) : resultUrls.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-[10px] text-zinc-500 uppercase font-bold mb-2">Resultados:</p>
                    <ScrollArea className="h-32 pr-4">
                      {resultUrls.map((res, i) => (
                        <div key={i} className="flex items-center justify-between p-2 rounded bg-zinc-950/50 border border-zinc-800 mb-2">
                          <span className="text-[10px] truncate max-w-[100px]">{res.name}</span>
                          <Button size="icon" variant="ghost" className="h-6 w-6 text-green-500" asChild>
                            <a href={res.url} download={res.name}><Download className="w-3 h-3" /></a>
                          </Button>
                        </div>
                      ))}
                    </ScrollArea>
                    <Button variant="outline" className="w-full h-8 text-xs border-zinc-800" onClick={() => setResultUrls([])}>Limpar</Button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-2">
                    <Button className="bg-orange-600 hover:bg-orange-500 text-white h-10 text-xs" onClick={() => processGroup(activeGroupId, 'merge')} disabled={videos.length === 0}>
                      <ListOrdered className="w-3 h-3 mr-2" /> Unir Sequencialmente
                    </Button>
                    <Button variant="outline" className="border-zinc-800 text-zinc-300 h-10 text-xs" onClick={() => processGroup(activeGroupId, 'batch')} disabled={videos.length === 0}>
                      <Package className="w-3 h-3 mr-2" /> Processar em Lote
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
      <Toaster theme="dark" position="bottom-right" />
    </div>
  );
}

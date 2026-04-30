import { useState } from "react";
import { useRequestUploadUrl, useCreateCall } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Upload as UploadIcon, FileAudio, AlertTriangle, CheckCircle2 } from "lucide-react";

export default function Upload() {
  const [, setLocation] = useLocation();
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "requesting" | "uploading" | "creating" | "done" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");

  const requestUrl = useRequestUploadUrl();
  const createCall = useCreateCall();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
      setStatus("idle");
      setErrorMsg("");
      setProgress(0);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile.type.startsWith("audio/")) {
        setFile(droppedFile);
        setStatus("idle");
        setErrorMsg("");
        setProgress(0);
      } else {
        setStatus("error");
        setErrorMsg("Only audio files are supported.");
      }
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    try {
      setStatus("requesting");
      
      // Step 1: Get presigned URL
      const { uploadURL, objectPath } = await requestUrl.mutateAsync({
        data: {
          name: file.name,
          size: file.size,
          contentType: file.type || "audio/mpeg"
        }
      });

      // Step 2: Upload directly to GCS via XMLHttpRequest to track progress
      setStatus("uploading");
      
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const percentComplete = (event.loaded / event.total) * 100;
            setProgress(percentComplete);
          }
        };
        
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        };
        
        xhr.onerror = () => reject(new Error("Network error during upload"));
        
        xhr.open("PUT", uploadURL, true);
        xhr.setRequestHeader("Content-Type", file.type || "audio/mpeg");
        xhr.send(file);
      });

      // Step 3: Create the call record in our DB
      setStatus("creating");
      const call = await createCall.mutateAsync({
        data: {
          objectPath,
          originalFilename: file.name
        }
      });

      // Step 4: Done, redirect
      setStatus("done");
      setLocation(`/calls/${call.id}`);

    } catch (err: any) {
      console.error("Upload flow failed:", err);
      setStatus("error");
      setErrorMsg(err.message || "An unexpected error occurred during upload.");
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Upload Transmission</h1>
        <p className="text-muted-foreground">Submit a raw audio recording for AI analysis.</p>
      </div>

      <Card className="bg-card">
        <CardHeader>
          <CardTitle>Audio File</CardTitle>
          <CardDescription>Upload an MP3, WAV, or M4A file from your device.</CardDescription>
        </CardHeader>
        <CardContent>
          <div 
            className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors ${
              file ? 'border-primary/50 bg-primary/5' : 'border-border hover:border-primary/30 hover:bg-secondary/50'
            }`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          >
            {file ? (
              <div className="space-y-4">
                <div className="bg-background w-16 h-16 rounded-full flex items-center justify-center mx-auto border border-primary">
                  <FileAudio className="h-8 w-8 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-lg">{file.name}</p>
                  <p className="text-sm text-muted-foreground">{formatBytes(file.size)}</p>
                </div>
                
                {status !== "idle" && status !== "error" && (
                  <div className="w-full max-w-md mx-auto mt-6 space-y-2">
                    <div className="flex justify-between text-xs font-medium">
                      <span>
                        {status === "requesting" && "Securing channel..."}
                        {status === "uploading" && "Transmitting data..."}
                        {status === "creating" && "Initializing analysis..."}
                        {status === "done" && "Transmission complete."}
                      </span>
                      <span>{Math.round(progress)}%</span>
                    </div>
                    <Progress value={progress} className="h-2" />
                  </div>
                )}

                {status === "error" && (
                  <div className="flex items-center justify-center text-destructive space-x-2 mt-4 bg-destructive/10 p-3 rounded-lg text-sm">
                    <AlertTriangle className="h-4 w-4" />
                    <span>{errorMsg}</span>
                  </div>
                )}
                
                {(status === "idle" || status === "error") && (
                  <div className="flex justify-center gap-4 mt-8">
                    <Button variant="outline" onClick={() => setFile(null)}>Clear</Button>
                    <Button onClick={handleUpload}>
                      <UploadIcon className="mr-2 h-4 w-4" />
                      Begin Upload
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-secondary w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                  <UploadIcon className="h-8 w-8 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-medium">Drag & Drop Audio</h3>
                <p className="text-sm text-muted-foreground">or click to browse your files</p>
                <div className="pt-4">
                  <label htmlFor="file-upload">
                    <Button asChild variant="secondary">
                      <span>Select File</span>
                    </Button>
                  </label>
                  <input 
                    id="file-upload" 
                    type="file" 
                    accept="audio/*" 
                    className="hidden" 
                    onChange={handleFileChange}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="mt-8 bg-secondary/50 rounded-lg p-4 border border-border/50 text-sm text-muted-foreground">
            <h4 className="font-medium text-foreground mb-2 flex items-center">
              <CheckCircle2 className="h-4 w-4 mr-2 text-primary" />
              Supported Formats
            </h4>
            <p>Upload standard audio formats (MP3, WAV, M4A, FLAC). The AI engine will automatically handle noise reduction, speaker diarization, and format conversion during the analysis phase.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

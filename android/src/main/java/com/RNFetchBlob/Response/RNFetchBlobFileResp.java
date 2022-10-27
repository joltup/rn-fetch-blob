package com.RNFetchBlob.Response;

import androidx.annotation.NonNull;

import com.RNFetchBlob.RNFetchBlobConst;
import com.RNFetchBlob.RNFetchBlobProgressConfig;
import com.RNFetchBlob.RNFetchBlobReq;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;

import okhttp3.MediaType;
import okhttp3.ResponseBody;
import okio.Buffer;
import okio.BufferedSource;
import okio.Okio;
import okio.Source;
import okio.Timeout;

/**
 * Created by wkh237 on 2016/7/11.
 */
public class RNFetchBlobFileResp extends ResponseBody {

    String mTaskId;
    ResponseBody originalBody;
    String mPath;
    long bytesDownloaded = 0;
    ReactApplicationContext rctContext;
    FileOutputStream ofStream;
    boolean isEndMarkerReceived;

    public RNFetchBlobFileResp(ReactApplicationContext ctx, String taskId, ResponseBody body, String path, boolean overwrite) throws IOException {
        super();
        this.rctContext = ctx;
        this.mTaskId = taskId;
        this.originalBody = body;
        assert path != null;
        this.mPath = path;
        this.isEndMarkerReceived = false;
        if (path != null) {
            boolean appendToExistingFile = !overwrite;
            path = path.replace("?append=true", "");
            mPath = path;
            File f = new File(path);

            File parent = f.getParentFile();
            if(parent != null && !parent.exists() && !parent.mkdirs()){
                throw new IllegalStateException("Couldn't create dir: " + parent);
            }

            if(!f.exists())
                f.createNewFile();
            ofStream = new FileOutputStream(new File(path), appendToExistingFile);
        }
    }

    @Override
    public MediaType contentType() {
        return originalBody.contentType();
    }

    @Override
    public long contentLength() {
        return originalBody.contentLength();
    }

    public boolean isDownloadComplete() {
        return (bytesDownloaded == contentLength()) // Case of non-chunked downloads
                || (contentLength() == -1 && isEndMarkerReceived); // Case of chunked downloads
    }

    @Override
    public BufferedSource source() {
        ProgressReportingSource countable = new ProgressReportingSource();
        return Okio.buffer(countable);
    }

    private class ProgressReportingSource implements Source {
        @Override
        public long read(@NonNull Buffer sink, long byteCount) throws IOException {
            try {
                byte[] bytes = new byte[(int) byteCount];
                long read = originalBody.byteStream().read(bytes, 0, (int) byteCount);
                bytesDownloaded += read > 0 ? read : 0;
                if (read > 0) {
                    ofStream.write(bytes, 0, (int) read);
                } else if (contentLength() == -1 && read == -1) {
                    // End marker has been received for chunked download
                    isEndMarkerReceived = true;
                }
                RNFetchBlobProgressConfig reportConfig = RNFetchBlobReq.getReportProgress(mTaskId);

                if (contentLength() != 0) {

                    // For non-chunked download, progress is received / total
                    // For chunked download, progress can be either 0 (started) or 1 (ended)
                    float progress = (contentLength() != -1) ? bytesDownloaded / contentLength() : ( ( isEndMarkerReceived ) ? 1 : 0 );

                    if (reportConfig != null && reportConfig.shouldReport(progress /* progress */)) {
                        if (contentLength() != -1) {
                            // For non-chunked downloads
                            reportProgress(mTaskId, bytesDownloaded, contentLength());
                        } else {
                            // For chunked downloads
                            if (!isEndMarkerReceived) {
                                reportProgress(mTaskId, 0, contentLength());
                            } else{
                                reportProgress(mTaskId, bytesDownloaded, bytesDownloaded);
                            }
                        }
                    }

                }

                return read;
            } catch(Exception ex) {
                return -1;
            }
        }

        private void reportProgress(String taskId, long bytesDownloaded, long contentLength) {
            WritableMap args = Arguments.createMap();
            args.putString("taskId", taskId);
            args.putString("written", String.valueOf(bytesDownloaded));
            args.putString("total", String.valueOf(contentLength));
            rctContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                    .emit(RNFetchBlobConst.EVENT_PROGRESS, args);
        }

        @Override
        public Timeout timeout() {
            return null;
        }

        @Override
        public void close() throws IOException {
            ofStream.close();

        }
    }

}

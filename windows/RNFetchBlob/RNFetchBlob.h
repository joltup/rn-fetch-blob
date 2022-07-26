#pragma once
#include "NativeModules.h"
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Security.Cryptography.h>
#include <winrt/Windows.Security.Cryptography.Core.h>
#include <winrt/Windows.Web.Http.Filters.h>
#include <mutex>

namespace Cryptography = winrt::Windows::Security::Cryptography;
namespace CryptographyCore = winrt::Windows::Security::Cryptography::Core;

enum struct EncodingOptions { UTF8, BASE64, ASCII, URI };

struct CancellationDisposable
{
	CancellationDisposable() = default;
	CancellationDisposable(winrt::Windows::Foundation::IAsyncInfo const& async, std::function<void()>&& onCancel) noexcept;

	CancellationDisposable(CancellationDisposable&& other) noexcept;
	CancellationDisposable& operator=(CancellationDisposable&& other) noexcept;

	CancellationDisposable(CancellationDisposable const&) = delete;
	CancellationDisposable& operator=(CancellationDisposable const&) = delete;

	~CancellationDisposable() noexcept;

	void Cancel() noexcept;
private:
	winrt::Windows::Foundation::IAsyncInfo m_async{ nullptr };
	std::function<void()> m_onCancel;
};

struct TaskCancellationManager
{
	using TaskId = std::string;

	TaskCancellationManager() = default;
	~TaskCancellationManager() noexcept;

	TaskCancellationManager(TaskCancellationManager const&) = delete;
	TaskCancellationManager& operator=(TaskCancellationManager const&) = delete;

	winrt::Windows::Foundation::IAsyncAction Add(TaskId taskId, winrt::Windows::Foundation::IAsyncAction const& asyncAction) noexcept;
	void Cancel(TaskId taskId) noexcept;

private:
	std::mutex m_mutex; // to protect m_pendingTasks
	std::map<TaskId, CancellationDisposable> m_pendingTasks;
};

struct RNFetchBlobState
{
	/*
		
		@"state": @"2", // store
		@"headers": headers, // store
		@"redirects": redirects, //check how to track, store
		@"respType" : respType, // store
		@"status": [NSNumber numberWithInteger : statusCode] // store
	*/
	std::string state;
	winrt::Microsoft::ReactNative::JSValueObject headers;
	winrt::Microsoft::ReactNative::JSValueArray redirects;
	std::string respType;
	int status = 0;

	/*
	taskId: string;
    state: string;
    headers: any;
    redirects: string[];
    status: number;
    respType: "text" | "blob" | "" | "json";
    rnfbEncode: "path" | "base64" | "ascii" | "utf8";
    timeout: boolean;
	*/
};


struct RNFetchBlobStream
{
public:
	RNFetchBlobStream(winrt::Windows::Storage::Streams::IRandomAccessStream& _streamInstance, EncodingOptions _encoding) noexcept;
	winrt::Windows::Storage::Streams::IRandomAccessStream streamInstance;
	const EncodingOptions encoding;
};

struct RNFetchBlobConfig
{
public:
	RNFetchBlobConfig(winrt::Microsoft::ReactNative::JSValueObject& options);

	bool overwrite;
	std::chrono::seconds timeout;
	bool trusty;
	bool fileCache;
	std::string key;
	std::string appendExt;
	std::string path;
	bool followRedirect;
};


struct RNFetchBlobProgressConfig {
public:
	RNFetchBlobProgressConfig() = default;
	RNFetchBlobProgressConfig(int32_t count_, int32_t interval_);
	
	int64_t count{ -1 };
	int64_t interval{ -1 };
};


REACT_MODULE(RNFetchBlob, L"RNFetchBlob");
struct RNFetchBlob : std::enable_shared_from_this<RNFetchBlob>
{
public:
	using StreamId = std::string;

	REACT_INIT(Initialize);
	void RNFetchBlob::Initialize(winrt::Microsoft::ReactNative::ReactContext const& reactContext) noexcept;

	REACT_CONSTANT_PROVIDER(ConstantsViaConstantsProvider);
	void RNFetchBlob::ConstantsViaConstantsProvider(
		winrt::Microsoft::ReactNative::ReactConstantProvider& constants) noexcept;

	// createFile
	REACT_METHOD(createFile);
	winrt::fire_and_forget createFile(
		std::string path,
		std::wstring content,
		std::string encoding,
		winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept;

	REACT_METHOD(createFileASCII);
	winrt::fire_and_forget createFileASCII(
		std::string path,
		winrt::Microsoft::ReactNative::JSValueArray dataArray,
		winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept;


	// writeFile
	REACT_METHOD(writeFile);
	winrt::fire_and_forget writeFile(
		std::string path,
		std::string encoding,
		std::wstring data,
		bool append,
		winrt::Microsoft::ReactNative::ReactPromise<int> promise) noexcept;

	REACT_METHOD(writeFileArray);
	winrt::fire_and_forget writeFileArray(
		std::string path,
		winrt::Microsoft::ReactNative::JSValueArray dataArray,
		bool append,
		winrt::Microsoft::ReactNative::ReactPromise<int> promise) noexcept;

	// writeStream
	REACT_METHOD(writeStream);
	winrt::fire_and_forget RNFetchBlob::writeStream(
		std::string path,
		std::string encoding,
		bool append,
		std::function<void(std::string, std::string, std::string)> callback) noexcept;

	// writeChunk
	REACT_METHOD(writeChunk);
	void RNFetchBlob::writeChunk(
		std::string streamId,
		std::wstring data,
		std::function<void(std::string)> callback) noexcept;

	REACT_METHOD(writeArrayChunk);
	void RNFetchBlob::writeArrayChunk(
		std::string streamId,
		winrt::Microsoft::ReactNative::JSValueArray dataArray,
		std::function<void(std::string)> callback) noexcept;

	// readStream
	REACT_METHOD(readStream);
	void RNFetchBlob::readStream(
		std::string path,
		std::string encoding,
		uint32_t bufferSize,
		uint64_t tick,
		const std::string streamId) noexcept;


	// mkdir
	REACT_METHOD(mkdir);
	void mkdir(
		std::string path,
		winrt::Microsoft::ReactNative::ReactPromise<bool> promise) noexcept;


	// readFile
	REACT_METHOD(readFile);
	winrt::fire_and_forget readFile(
		std::string path,
		std::string encoding,
		winrt::Microsoft::ReactNative::ReactPromise<std::wstring> promise) noexcept;


	// hash
	REACT_METHOD(hash);
	winrt::fire_and_forget hash(
		std::string path,
		std::string algorithm,
		winrt::Microsoft::ReactNative::ReactPromise<std::wstring> promise) noexcept;

	// ls
	REACT_METHOD(ls);
	winrt::fire_and_forget ls(
		std::string path,
		winrt::Microsoft::ReactNative::ReactPromise<std::vector<std::string>> promise) noexcept;


	// mv
	REACT_METHOD(mv);
	winrt::fire_and_forget mv(
		std::string src, // from
		std::string dest, // to
		std::function<void(std::string)> callback) noexcept;


	// cp
	REACT_METHOD(cp);
	winrt::fire_and_forget cp(
		std::string src, // from
		std::string dest, // to
		std::function<void(std::string)> callback) noexcept;


	// exists
	REACT_METHOD(exists);
	void exists(
		std::string path,
		std::function<void(bool, bool)> callback) noexcept;


	// unlink
	REACT_METHOD(unlink);
	winrt::fire_and_forget unlink(
		std::string path,
		std::function<void(std::string, bool)> callback) noexcept;


	// lstat
	REACT_METHOD(lstat);
	winrt::fire_and_forget lstat(
		std::string path,
		std::function<void(std::string, winrt::Microsoft::ReactNative::JSValueArray&)> callback) noexcept;


	// stat
	REACT_METHOD(stat);
	winrt::fire_and_forget stat(
		std::string path,
		std::function<void(std::string, winrt::Microsoft::ReactNative::JSValueObject&)> callback) noexcept;

	// df
	REACT_METHOD(df);
	winrt::fire_and_forget df(
		std::function<void(std::string, winrt::Microsoft::ReactNative::JSValueObject&)> callback) noexcept;

	REACT_METHOD(slice);
	winrt::fire_and_forget RNFetchBlob::slice(
		std::string src,
		std::string dest,
		uint32_t start,
		uint32_t end,
		winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept;

	REACT_METHOD(fetchBlob);
	winrt::fire_and_forget fetchBlob(
		winrt::Microsoft::ReactNative::JSValueObject options,
		std::string taskId,
		std::string method,
		std::wstring url,
		winrt::Microsoft::ReactNative::JSValueObject headers,
		std::string body,
		std::function<void(std::string, std::string, std::string)> callback) noexcept;

	REACT_METHOD(fetchBlobForm);
	winrt::fire_and_forget  fetchBlobForm(
		winrt::Microsoft::ReactNative::JSValueObject options,
		std::string taskId,
		std::string method,
		std::wstring url,
		winrt::Microsoft::ReactNative::JSValueObject headers,
		winrt::Microsoft::ReactNative::JSValueArray body,
		std::function<void(std::string, std::string, std::string)> callback) noexcept;

	REACT_METHOD(enableProgressReport);
	void enableProgressReport(
		std::string taskId,
		int interval,
		int count) noexcept;

	// enableUploadProgressReport
	REACT_METHOD(enableUploadProgressReport);
	void enableUploadProgressReport(
		std::string taskId,
		int interval,
		int count) noexcept;

	// cancelRequest
	REACT_METHOD(cancelRequest);
	void cancelRequest(
		std::string taskId,
		std::function<void(std::string, std::string)> callback) noexcept;

	REACT_METHOD(removeSession);
	winrt::fire_and_forget RNFetchBlob::removeSession(
		winrt::Microsoft::ReactNative::JSValueArray paths,
		std::function<void(std::string)> callback) noexcept;

	REACT_METHOD(closeStream);
	void closeStream(
		std::string streamId,
		std::function<void(std::string)> callback) noexcept;

	// Helper methods
private:
	

	constexpr static int64_t UNIX_EPOCH_IN_WINRT_SECONDS = 11644473600;

	std::map<StreamId, RNFetchBlobStream> m_streamMap;
	//winrt::Windows::Web::Http::HttpClient m_httpClient;
	winrt::Microsoft::ReactNative::ReactContext m_reactContext;
	TaskCancellationManager m_tasks;

	winrt::Windows::Foundation::IAsyncAction ProcessRequestAsync(
		const std::string& taskId,
		const winrt::Windows::Web::Http::Filters::HttpBaseProtocolFilter& filter,
		winrt::Windows::Web::Http::HttpRequestMessage& httpRequestMessage,
		RNFetchBlobConfig& config,
		std::function<void(std::string, std::string, std::string)> callback,
		std::string& error) noexcept;

	const std::map<std::string, std::function<CryptographyCore::HashAlgorithmProvider()>> availableHashes{
		{"md5", []() { return CryptographyCore::HashAlgorithmProvider::OpenAlgorithm(CryptographyCore::HashAlgorithmNames::Md5()); } },
		{"sha1", []() { return CryptographyCore::HashAlgorithmProvider::OpenAlgorithm(CryptographyCore::HashAlgorithmNames::Sha1()); } },
		{"sha256", []() { return CryptographyCore::HashAlgorithmProvider::OpenAlgorithm(CryptographyCore::HashAlgorithmNames::Sha256()); } },
		{"sha384", []() { return CryptographyCore::HashAlgorithmProvider::OpenAlgorithm(CryptographyCore::HashAlgorithmNames::Sha384()); } },
		{"sha512", []() { return CryptographyCore::HashAlgorithmProvider::OpenAlgorithm(CryptographyCore::HashAlgorithmNames::Sha512()); } }
	};

	void splitPath(const std::string& fullPath,
		winrt::hstring& directoryPath,
		winrt::hstring& fileName) noexcept;

	void splitPath(const std::wstring& fullPath,
		winrt::hstring& directoryPath,
		winrt::hstring& fileName) noexcept;

	const std::string prefix{ "RNFetchBlob-file://" };

	std::mutex m_mutex;
	std::map<std::string, RNFetchBlobProgressConfig> downloadProgressMap;
	std::map<std::string, RNFetchBlobProgressConfig> uploadProgressMap;
};




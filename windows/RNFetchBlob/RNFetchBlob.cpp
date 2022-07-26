#include "pch.h"
#include "RNFetchBlob.h"
#include <winrt/Windows.ApplicationModel.Activation.h>
#include <winrt/Windows.Security.Cryptography.h>
#include <winrt/Windows.Security.Cryptography.Core.h>
#include <winrt/Windows.Storage.FileProperties.h>
#include <winrt/Windows.Storage.Streams.h>
#include <winrt/Windows.Storage.h>
#include <winrt/Windows.Web.Http.h>
#include <winrt/Windows.Web.Http.Headers.h>
#include <winrt/windows.web.http.filters.h>
#include <filesystem>
#include <sstream> 

using namespace winrt;
using namespace winrt::Windows::ApplicationModel;
using namespace winrt::Windows::Storage;
using namespace winrt::Windows::Storage::Streams;
using namespace winrt::Windows::Foundation;
using namespace winrt::Windows::Security::Cryptography;
using namespace winrt::Windows::Security::Cryptography::Core;
using namespace std::chrono_literals;

CancellationDisposable::CancellationDisposable(IAsyncInfo const& async, std::function<void()>&& onCancel) noexcept
	: m_async{ async }
	, m_onCancel{ std::move(onCancel) }
{
}

CancellationDisposable::CancellationDisposable(CancellationDisposable&& other) noexcept
	: m_async{ std::move(other.m_async) }
	, m_onCancel{ std::move(other.m_onCancel) }
{
}

CancellationDisposable& CancellationDisposable::operator=(CancellationDisposable&& other) noexcept
{
	if (this != &other)
	{
		CancellationDisposable temp{ std::move(*this) };
		m_async = std::move(other.m_async);
		m_onCancel = std::move(other.m_onCancel);
	}
	return *this;
}

CancellationDisposable::~CancellationDisposable() noexcept
{
	Cancel();
}

void CancellationDisposable::Cancel() noexcept
{
	if (m_async)
	{
		if (m_async.Status() == AsyncStatus::Started)
		{
			m_async.Cancel();
		}

		if (m_onCancel)
		{
			m_onCancel();
		}
	}
}

TaskCancellationManager::~TaskCancellationManager() noexcept
{
	// Do the explicit cleaning to make sure that CancellationDisposable
	// destructors run while this instance still has valid fields because
	// they are used by the onCancel callback.
	// We also want to clear the m_pendingTasks before running the
	// CancellationDisposable destructors since they touch the m_pendingTasks.
	std::map<TaskId, CancellationDisposable> pendingTasks;
	{
		std::scoped_lock lock{ m_mutex };
		pendingTasks = std::move(m_pendingTasks);
	}
}


IAsyncAction TaskCancellationManager::Add(TaskId taskId, IAsyncAction const& asyncAction) noexcept
{
	std::scoped_lock lock{ m_mutex };
	m_pendingTasks.try_emplace(taskId, asyncAction, [this, taskId]()
		{
			Cancel(taskId);
		});
	return asyncAction;
}

void TaskCancellationManager::Cancel(TaskId taskId) noexcept
{
	// The destructor of the token does the cancellation. We must do it outside of lock.
	CancellationDisposable token;

	{
		std::scoped_lock lock{ m_mutex };
		if (!m_pendingTasks.empty())
		{
			if (auto it = m_pendingTasks.find(taskId); it != m_pendingTasks.end())
			{
				token = std::move(it->second);
				m_pendingTasks.erase(it);
			}
		}
	}
}

RNFetchBlobConfig::RNFetchBlobConfig(winrt::Microsoft::ReactNative::JSValueObject& options) {
	if (options["appendExt"].IsNull() == true)
	{
		appendExt = "";
	}
	else
	{
		appendExt = options["appendExt"].AsString();
	}
	fileCache = options["fileCache"].AsBoolean();
	followRedirect = options["followRedirect"].AsBoolean();
	overwrite = options["overwrite"].AsBoolean();
	if (options["path"].IsNull() == true)
	{
		path = "";
	}
	else
	{
		auto filepath{ options["path"].AsString() };
		auto fileLength{ filepath.length() };
		bool hasTrailingSlash{ filepath[fileLength - 1] == '\\' || filepath[fileLength - 1] == '/' };
		std::filesystem::path pathToParse{ hasTrailingSlash ? filepath.substr(0, fileLength - 1) : filepath };
		pathToParse.make_preferred();
		path = pathToParse.string();
	}
	trusty = options["trusty"].AsBoolean();

	int64_t potentialTimeout{ options["timeout"].AsInt64() };
	timeout = std::chrono::seconds{ potentialTimeout > 0 ? potentialTimeout : 60000 };

}

RNFetchBlobProgressConfig::RNFetchBlobProgressConfig(int32_t count_, int32_t interval_) : count(count_), interval(interval_) {
}

void RNFetchBlob::Initialize(winrt::Microsoft::ReactNative::ReactContext const& reactContext) noexcept
{
	m_reactContext = reactContext;
}

//
// RNFS implementations
//
void RNFetchBlob::ConstantsViaConstantsProvider(winrt::Microsoft::ReactNative::ReactConstantProvider& constants) noexcept
{
	// RNFetchBlob.DocumentDir
	constants.Add(L"DocumentDir", to_string(ApplicationData::Current().LocalFolder().Path()));

	// RNFetchBlob.CacheDir
	constants.Add(L"CacheDir", to_string(ApplicationData::Current().LocalCacheFolder().Path()));

	// RNFetchBlob.PictureDir
	constants.Add(L"PictureDir", UserDataPaths::GetDefault().Pictures());

	// RNFetchBlob.MusicDir
	constants.Add(L"MusicDir", UserDataPaths::GetDefault().Music());

	// RNFetchBlob.MovieDir
	constants.Add(L"MovieDir", UserDataPaths::GetDefault().Videos());

	// RNFetchBlob.DownloadDirectoryPath - IMPLEMENT for convenience? (absent in iOS and deprecated in Android)
	constants.Add(L"DownloadDir", UserDataPaths::GetDefault().Downloads());

	// RNFetchBlob.MainBundleDir
	constants.Add(L"MainBundleDir", to_string(Package::Current().InstalledLocation().Path()));
}

// createFile
winrt::fire_and_forget RNFetchBlob::createFile(
	std::string path,
	std::wstring content,
	std::string encoding,
	winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept
try
{
	bool shouldExit{ false };
	Streams::IBuffer buffer;
	if (encoding.compare("uri") == 0)
	{
		try
		{
			winrt::hstring srcDirectoryPath, srcFileName;
			splitPath(content, srcDirectoryPath, srcFileName);
			StorageFolder srcFolder{ co_await StorageFolder::GetFolderFromPathAsync(srcDirectoryPath) };
			StorageFile srcFile{ co_await srcFolder.GetFileAsync(srcFileName) };
			buffer = co_await FileIO::ReadBufferAsync(srcFile);
		}
		catch (...)
		{
			shouldExit = true;
		}
	}
	else if (encoding.compare("utf8") == 0)
	{
		buffer = CryptographicBuffer::ConvertStringToBinary(content, BinaryStringEncoding::Utf8);
	}
	else if (encoding.compare("base64") == 0)
	{
		buffer = CryptographicBuffer::DecodeFromBase64String(content);
	}
	else
	{
		promise.Reject("Invalid encoding");
		shouldExit = true;
	}

	if (!shouldExit)
	{

		winrt::hstring destDirectoryPath, destFileName;
		splitPath(path, destDirectoryPath, destFileName);

		auto folder{ co_await StorageFolder::GetFolderFromPathAsync(destDirectoryPath) };

		try
		{
			auto file{ co_await folder.CreateFileAsync(destFileName, CreationCollisionOption::FailIfExists) };
			auto stream{ co_await file.OpenAsync(FileAccessMode::ReadWrite) };
			co_await stream.WriteAsync(buffer);
		}
		catch (...)
		{
			promise.Reject(winrt::Microsoft::ReactNative::ReactError{ "EEXIST", "EEXIST: File already exists; " + path });
			shouldExit = true;
		}
	}
	if (!shouldExit)
	{
		promise.Resolve(path);
	}
	co_return;
}
catch (const hresult_error& ex)
{
	hresult result{ ex.code() };
	if (result == 0x80070002) // FileNotFoundException
	{
		promise.Reject(winrt::Microsoft::ReactNative::ReactError{ "ENOENT", "ENOENT: File does not exist and could not be created; " + path });
	}
	else
	{
		promise.Reject(winrt::Microsoft::ReactNative::ReactError{ "EUNSPECIFIED", "EUNSPECIFIED: " + winrt::to_string(ex.message()) +  "; " + path  });
	}
}

winrt::fire_and_forget RNFetchBlob::createFileASCII(
	std::string path,
	winrt::Microsoft::ReactNative::JSValueArray dataArray,
	winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept
	try
{
	std::vector<uint8_t> data;
	data.reserve(dataArray.size());
	for (auto& var : dataArray)
	{
		data.push_back(var.AsUInt8());
	}

	Streams::IBuffer buffer{ CryptographicBuffer::CreateFromByteArray(data) };

	winrt::hstring directoryPath, fileName;
	splitPath(path, directoryPath, fileName);

	StorageFolder folder{ co_await StorageFolder::GetFolderFromPathAsync(directoryPath) };

	StorageFile file{ co_await folder.CreateFileAsync(fileName, CreationCollisionOption::FailIfExists) };
	Streams::IRandomAccessStream stream{ co_await file.OpenAsync(FileAccessMode::ReadWrite) };
	co_await stream.WriteAsync(buffer);

	promise.Resolve(path);
}
catch (const hresult_error& ex)
{
	hresult result{ ex.code() };
	if (result == 0x80070002) // FileNotFoundException
	{
		promise.Reject(winrt::Microsoft::ReactNative::ReactError{ "ENOENT", "ENOENT: File does not exist and could not be created; " + path });
	}
	else if (result == 0x80070050) 
	{
		promise.Reject(winrt::Microsoft::ReactNative::ReactError{ "EEXIST", "EEXIST: File already exists; " + path });
	}
	else
	{	
		promise.Reject(winrt::Microsoft::ReactNative::ReactError{ "EUNSPECIFIED", "EUNSPECIFIED: " + winrt::to_string(ex.message()) });
	}
}


// writeFile
winrt::fire_and_forget RNFetchBlob::writeFile(
	std::string path,
	std::string encoding,
	std::wstring data,
	bool append,
	winrt::Microsoft::ReactNative::ReactPromise<int> promise) noexcept
try
{
	Streams::IBuffer buffer;
	if (encoding.compare("utf8") == 0)
	{
		buffer = Cryptography::CryptographicBuffer::ConvertStringToBinary(data, BinaryStringEncoding::Utf8);
	}
	else if (encoding.compare("base64") == 0)
	{
		buffer = Cryptography::CryptographicBuffer::DecodeFromBase64String(data);
	}
	else if (encoding.compare("uri") == 0)
	{
		winrt::hstring srcDirectoryPath, srcFileName;
		splitPath(data, srcDirectoryPath, srcFileName);
		StorageFolder srcFolder{ co_await StorageFolder::GetFolderFromPathAsync(srcDirectoryPath) };
		StorageFile srcFile{ co_await srcFolder.GetFileAsync(srcFileName) };
		buffer = co_await FileIO::ReadBufferAsync(srcFile);
	}
	else
	{
		auto errorMessage{ "Invalid encoding: " + encoding };
		promise.Reject(errorMessage.c_str());
	}

	winrt::hstring destDirectoryPath, destFileName;
	splitPath(path, destDirectoryPath, destFileName);
	StorageFolder destFolder{ co_await StorageFolder::GetFolderFromPathAsync(destDirectoryPath) };
	StorageFile destFile{ nullptr };
	if (append)
	{
		destFile = co_await destFolder.CreateFileAsync(destFileName, CreationCollisionOption::OpenIfExists);
	}
	else
	{
		destFile = co_await destFolder.CreateFileAsync(destFileName, CreationCollisionOption::ReplaceExisting);
	}
	Streams::IRandomAccessStream stream{ co_await destFile.OpenAsync(FileAccessMode::ReadWrite) };

	if (append)
	{
		stream.Seek(UINT64_MAX);
	}
	co_await stream.WriteAsync(buffer);
	promise.Resolve(buffer.Length());
}
catch (const hresult_error& ex)
{
	promise.Reject(winrt::Microsoft::ReactNative::ReactError{ "EUNSPECIFIED", "EUNSPECIFIED: " + winrt::to_string(ex.message()) + "; " + path });
}

winrt::fire_and_forget RNFetchBlob::writeFileArray(
	std::string path,
	winrt::Microsoft::ReactNative::JSValueArray dataArray,
	bool append,
	winrt::Microsoft::ReactNative::ReactPromise<int> promise) noexcept
	try
{
	std::vector<uint8_t> data;
	data.reserve(dataArray.size());
	for (auto& var : dataArray)
	{
		data.push_back(var.AsUInt8());
	}
	Streams::IBuffer buffer{ CryptographicBuffer::CreateFromByteArray(data) };

	winrt::hstring destDirectoryPath, destFileName;
	splitPath(path, destDirectoryPath, destFileName);
	StorageFolder destFolder{ co_await StorageFolder::GetFolderFromPathAsync(destDirectoryPath) };
	StorageFile destFile{ nullptr };
	if (append)
	{
		destFile = co_await destFolder.CreateFileAsync(destFileName, CreationCollisionOption::OpenIfExists);
	}
	else
	{
		destFile = co_await destFolder.CreateFileAsync(destFileName, CreationCollisionOption::ReplaceExisting);
	}
	Streams::IRandomAccessStream stream{ co_await destFile.OpenAsync(FileAccessMode::ReadWrite) };

	if (append)
	{
		stream.Seek(UINT64_MAX);
	}
	co_await stream.WriteAsync(buffer);
	promise.Resolve(buffer.Length());

	co_return;
}
catch (const hresult_error& ex)
{
	promise.Reject(winrt::Microsoft::ReactNative::ReactError{ "EUNSPECIFIED", "EUNSPECIFIED: " + winrt::to_string(ex.message()) + "; " + path });
}


// writeStream
winrt::fire_and_forget RNFetchBlob::writeStream(
	std::string path,
	std::string encoding,
	bool append,
	std::function<void(std::string, std::string, std::string)> callback) noexcept
try
{
	winrt::hstring directoryPath, fileName;
	splitPath(path, directoryPath, fileName);
	StorageFolder folder{ co_await StorageFolder::GetFolderFromPathAsync(directoryPath) };
	StorageFile file{ co_await folder.CreateFileAsync(fileName, CreationCollisionOption::OpenIfExists) };
	std::string temp{encoding};
	Streams::IRandomAccessStream stream{ co_await file.OpenAsync(FileAccessMode::ReadWrite) };
	if (append)
	{
		stream.Seek(stream.Size());
	}
	EncodingOptions encodingOption;
	if (encoding.compare("utf8") == 0)
	{
		encodingOption = EncodingOptions::UTF8;
	}
	else if (encoding.compare("base64") == 0)
	{
		encodingOption = EncodingOptions::BASE64;
	}
	else if (encoding.compare("ascii") == 0)
	{
		encodingOption = EncodingOptions::ASCII;
	}
	else
	{
		co_return;
	}

	// Define the length, in bytes, of the buffer.
	uint32_t length = 128;
	// Generate random data and copy it to a buffer.
	IBuffer buffer = Cryptography::CryptographicBuffer::GenerateRandom(length);
	// Encode the buffer to a hexadecimal string (for display).
	std::string streamId = winrt::to_string(Cryptography::CryptographicBuffer::EncodeToHexString(buffer));

	RNFetchBlobStream streamInstance{ stream, encodingOption };
	m_streamMap.try_emplace(streamId, streamInstance);

	callback("", "", streamId);
}
catch (const hresult_error& ex)
{
	callback("EUNSPECIFIED", "Failed to create write stream at path '" + path + "'; " + winrt::to_string(ex.message().c_str()), "");
}


// writeChunk
void RNFetchBlob::writeChunk(
	std::string streamId,
	std::wstring data,
	std::function<void(std::string)> callback) noexcept
try
{
	auto stream{ m_streamMap.find(streamId)->second };
	Streams::IBuffer buffer;
	if (stream.encoding == EncodingOptions::UTF8)
	{
		buffer = Cryptography::CryptographicBuffer::ConvertStringToBinary(data, BinaryStringEncoding::Utf8);
	}
	else if (stream.encoding == EncodingOptions::BASE64)
	{
		buffer = Cryptography::CryptographicBuffer::DecodeFromBase64String(data);
	}
	else
	{
		callback("Invalid encoding type");
		return;
	}
	stream.streamInstance.WriteAsync(buffer).get(); //Calls it synchronously
	callback("");
}
catch (const hresult_error& ex)
{
	callback(winrt::to_string(ex.message().c_str()));
}

void RNFetchBlob::writeArrayChunk(
	std::string streamId,
	winrt::Microsoft::ReactNative::JSValueArray dataArray,
	std::function<void(std::string)> callback) noexcept
	try
{
	auto stream{ m_streamMap.find(streamId)->second };
	std::vector<uint8_t> data;
	data.reserve(dataArray.size());
	for (auto& var : dataArray)
	{
		data.push_back(var.AsUInt8());
	}
	Streams::IBuffer buffer{ CryptographicBuffer::CreateFromByteArray(data) };

	stream.streamInstance.WriteAsync(buffer).get(); // Calls it synchronously
	callback("");
}
catch (const hresult_error& ex)
{
	callback(winrt::to_string(ex.message().c_str()));
}

// readStream - no promises, callbacks, only event emission
void RNFetchBlob::readStream(
	std::string path,
	std::string encoding,
	uint32_t bufferSize,
	uint64_t tick,
	const std::string streamId) noexcept
try
{
	EncodingOptions usedEncoding;
	if (encoding.compare("utf8") == 0)
	{
		usedEncoding = EncodingOptions::UTF8;
	}
	else if (encoding.compare("base64") == 0)
	{
		usedEncoding = EncodingOptions::BASE64;
	}
	else if (encoding.compare("ascii") == 0)
	{
		usedEncoding = EncodingOptions::ASCII;
	}
	else
	{
		//Wrong encoding
		return;
	}

	uint32_t chunkSize{ usedEncoding == EncodingOptions::BASE64 ? (uint32_t)4095 : (uint32_t)4096 };
	if (bufferSize > 0)
	{
		chunkSize = bufferSize;
	}

	winrt::hstring directoryPath, fileName;
	splitPath(path, directoryPath, fileName);
	StorageFolder folder{ StorageFolder::GetFolderFromPathAsync(directoryPath).get() };
	StorageFile file{ folder.GetFileAsync(fileName).get() };

	Streams::IRandomAccessStream stream{ file.OpenAsync(FileAccessMode::Read).get() };
	Buffer buffer{ chunkSize };
	const TimeSpan time{ tick };
	IAsyncAction timer;

	for (;;)
	{
		auto readBuffer = stream.ReadAsync(buffer, buffer.Capacity(), InputStreamOptions::None).get();
		if (readBuffer.Length() == 0)
		{
			m_reactContext.CallJSFunction(L"RCTDeviceEventEmitter", L"emit", streamId,
				winrt::Microsoft::ReactNative::JSValueObject{
					{"event", "end"},
				});
			break;
		}
		if (usedEncoding == EncodingOptions::BASE64)
		{
			// TODO: Investigate returning wstrings as parameters
			winrt::hstring base64Content{ Cryptography::CryptographicBuffer::EncodeToBase64String(readBuffer) };
			//m_reactContext.CallJSFunction(L"RCTDeviceEventEmitter", L"emit", [&streamId, &base64Content](React::IJSValueWriter const& argWriter) {
			//	argWriter.WriteArrayBegin();
			//	WriteValue(argWriter, streamId);
			//	argWriter.WriteObjectBegin();
			//	React::WriteProperty(argWriter, "event", "data");
			//	React::WriteProperty(argWriter, "detail", base64Content);
			//	argWriter.WriteObjectEnd();
			//	argWriter.WriteArrayEnd();
			//	});
			m_reactContext.CallJSFunction(L"RCTDeviceEventEmitter", L"emit", streamId,
				winrt::Microsoft::ReactNative::JSValueObject{
					{"event", "data"},
					{"detail", winrt::to_string(base64Content)},
				});
		}
		else
		{
			// TODO: Sending events not working as necessary with writers
			std::string utf8Content{ winrt::to_string(Cryptography::CryptographicBuffer::ConvertBinaryToString(BinaryStringEncoding::Utf8, readBuffer)) };
			if (usedEncoding == EncodingOptions::ASCII)
			{

				//std::string asciiContent{ winrt::to_string(utf8Content) };
				std::string asciiContent{ utf8Content };
				// emit ascii content
				m_reactContext.CallJSFunction(L"RCTDeviceEventEmitter", L"emit", streamId,
					winrt::Microsoft::ReactNative::JSValueObject{
						{"event", "data"},
						{"detail", asciiContent},
					});
			}
			else
			{
				//emit utf8 content
				m_reactContext.CallJSFunction(L"RCTDeviceEventEmitter", L"emit", streamId,
					winrt::Microsoft::ReactNative::JSValueObject{
						{"event", "data"},
						{"detail", utf8Content},
					});
				//m_reactContext.CallJSFunction(L"RCTDeviceEventEmitter", L"emit", [&streamId, &utf8Content](React::IJSValueWriter const& argWriter) {
				//	WriteValue(argWriter, streamId);
				//	argWriter.WriteObjectBegin();
				//	React::WriteProperty(argWriter, "event", L"data");
				//	React::WriteProperty(argWriter, "detail", utf8Content);
				//	argWriter.WriteObjectEnd();
				//	});
			}
		}
		// sleep
		if (tick > 0)
		{
			std::this_thread::sleep_for(std::chrono::milliseconds(tick));
		}
	}
}
catch (const hresult_error& ex)
{
	hresult result{ ex.code() };
	if (result == 0x80070002) // FileNotFoundException
	{
		m_reactContext.CallJSFunction(L"RCTDeviceEventEmitter", L"emit", streamId,
			winrt::Microsoft::ReactNative::JSValueObject{
				{"event", "error"},
				{"ENOENT", "No such file '" + path + "'"},
			});
	}
	else
	{
		m_reactContext.CallJSFunction(L"RCTDeviceEventEmitter", L"emit", streamId,
			winrt::Microsoft::ReactNative::JSValueObject{
				{"event", "error"},
				{"EUNSPECIFIED", winrt::to_string(ex.message())},
			});
	}
}


// mkdir
void RNFetchBlob::mkdir(
	std::string path,
	winrt::Microsoft::ReactNative::ReactPromise<bool> promise) noexcept
	try
{
	std::filesystem::path dirPath(path);
	dirPath.make_preferred();

	// Consistent with Apple's createDirectoryAtPath method and result, but not with Android's
	if (std::filesystem::create_directories(dirPath) == false)
	{
		promise.Reject(winrt::Microsoft::ReactNative::ReactError{ "ENOENT", "ENOENT: no such file or directory, open " + path });
	}
	else
	{
		promise.Resolve(true);
	}
}
catch (const hresult_error& ex)
{
	promise.Reject(winrt::Microsoft::ReactNative::ReactError{ "EUNSPECIFIED", "Error creating folder " + path + ", error: " + winrt::to_string(ex.message().c_str()) });
}


// readFile - TODO: try returning wchar array and investigate different return types
winrt::fire_and_forget RNFetchBlob::readFile(
	std::string path,
	std::string encoding,
	winrt::Microsoft::ReactNative::ReactPromise<std::wstring> promise) noexcept
try
{
	winrt::hstring directoryPath, fileName;
	splitPath(path, directoryPath, fileName);

	StorageFolder folder{ co_await StorageFolder::GetFolderFromPathAsync(directoryPath) };
	StorageFile file{ co_await folder.GetFileAsync(fileName) };

	Streams::IBuffer buffer{ co_await FileIO::ReadBufferAsync(file) };
	if (encoding.compare("base64") == 0)
	{
		std::wstring base64Content{ Cryptography::CryptographicBuffer::EncodeToBase64String(buffer) };
		promise.Resolve(base64Content);
	}
	else
	{
		std::wstring utf8Content{ Cryptography::CryptographicBuffer::ConvertBinaryToString(BinaryStringEncoding::Utf8, buffer) };
		if (encoding.compare("ascii") == 0)
		{
			std::string asciiContent{ winrt::to_string(utf8Content) };
			std::wstring asciiResult{ winrt::to_hstring(asciiContent) };
			promise.Resolve(asciiResult);
			co_return;
		}
		promise.Resolve(utf8Content);
	}
}
catch (const hresult_error& ex)
{
	hresult result{ ex.code() };
	if (result == 0x80070002) // FileNotFoundException
	{
		promise.Reject(winrt::Microsoft::ReactNative::ReactError{ "ENOENT", "ENOENT: no such file or directory, open " + path });
	}
	else if (result == 0x80070005) // UnauthorizedAccessException
	{
		promise.Reject(winrt::Microsoft::ReactNative::ReactError{ "EISDIR", "EISDIR: illegal operation on a directory, read" });
	}
	else
	{
		// "Failed to read file."
		promise.Reject(winrt::to_string(ex.message()).c_str());
	}
}


// hash
winrt::fire_and_forget RNFetchBlob::hash(
	std::string path,
	std::string algorithm,
	winrt::Microsoft::ReactNative::ReactPromise<std::wstring> promise) noexcept
	try
{
	// Note: SHA224 is not part of winrt 
	if (algorithm.compare("sha224") == 0)
	{
		promise.Reject(winrt::Microsoft::ReactNative::ReactError{ "Error", "WinRT does not offer sha224 encryption." });
		co_return;
	}

	winrt::hstring directoryPath, fileName;
	splitPath(path, directoryPath, fileName);

	StorageFolder folder{ co_await StorageFolder::GetFolderFromPathAsync(directoryPath) };
	StorageFile file{ co_await folder.GetFileAsync(fileName) };

	auto search{ availableHashes.find(algorithm) };
	if (search == availableHashes.end())
	{
		promise.Reject(winrt::Microsoft::ReactNative::ReactError{ "Error", "Invalid hash algorithm " + algorithm });
		co_return;
	}

	CryptographyCore::HashAlgorithmProvider provider{ search->second() };
	Streams::IBuffer buffer{ co_await FileIO::ReadBufferAsync(file) };

	auto hashedBuffer{ provider.HashData(buffer) };
	std::wstring result{ Cryptography::CryptographicBuffer::EncodeToHexString(hashedBuffer) };

	promise.Resolve(result);
}
catch (const hresult_error& ex)
{
	hresult result{ ex.code() };
	if (result == 0x80070002) // FileNotFoundException
	{
		promise.Reject(winrt::Microsoft::ReactNative::ReactError{ "ENOENT", "ENOENT: no such file or directory, open " + path });
	}
	else if (result == 0x80070005) // UnauthorizedAccessException
	{
		promise.Reject(winrt::Microsoft::ReactNative::ReactError{ "EISDIR", "EISDIR: illegal operation on a directory, read" });
	}
	else
	{
		// "Failed to get checksum from file."
		promise.Reject(winrt::to_string(ex.message()).c_str());
	}
}


// ls
winrt::fire_and_forget RNFetchBlob::ls(
	std::string path,
	winrt::Microsoft::ReactNative::ReactPromise<std::vector<std::string>> promise) noexcept
	try
{
	winrt::hstring directoryPath, fileName;
	splitPath(path, directoryPath, fileName);

	StorageFolder targetDirectory{ co_await StorageFolder::GetFolderFromPathAsync(directoryPath) };

	std::vector<std::string> results;
	auto items{ co_await targetDirectory.GetItemsAsync() };
	for (auto item : items)
	{
		results.push_back(to_string(item.Name()));
	}
	promise.Resolve(results);
}
catch (const hresult_error& ex)
{
	hresult result{ ex.code() };
	if (result == 0x80070002) // FileNotFoundException
	{
		promise.Reject(winrt::Microsoft::ReactNative::ReactError{ "ENOTDIR", "Not a directory '" + path + "'" });
	}
	else
	{
		promise.Reject(winrt::Microsoft::ReactNative::ReactError{ "EUNSPECIFIED", winrt::to_string(ex.message()).c_str() });
	}
}


// mv
winrt::fire_and_forget RNFetchBlob::mv(
	std::string src, // from
	std::string dest, // to
	std::function<void(std::string)> callback) noexcept
{
	try
	{
		winrt::hstring srcDirectoryPath, srcFileName;
		splitPath(src, srcDirectoryPath, srcFileName);

		winrt::hstring destDirectoryPath, destFileName;
		splitPath(dest, destDirectoryPath, destFileName);

		StorageFolder srcFolder{ co_await StorageFolder::GetFolderFromPathAsync(srcDirectoryPath) };
		StorageFolder destFolder{ co_await StorageFolder::GetFolderFromPathAsync(destDirectoryPath) };
		StorageFile file{ co_await srcFolder.GetFileAsync(srcFileName) };

		co_await file.MoveAsync(destFolder, destFileName, NameCollisionOption::ReplaceExisting);
		callback("");
	}
	catch (const hresult_error& ex)
	{
		hresult result{ ex.code() };
		if (result == 0x80070002) // FileNotFoundException
		{
			callback("Source file not found.");
		}
		else
		{
			callback(winrt::to_string(ex.message()).c_str());
		}
	}
}


// cp
winrt::fire_and_forget RNFetchBlob::cp(
	std::string src, // from
	std::string dest, // to
	std::function<void(std::string)> callback) noexcept
	try
{
	winrt::hstring srcDirectoryPath, srcFileName;
	splitPath(src, srcDirectoryPath, srcFileName);

	winrt::hstring destDirectoryPath, destFileName;
	splitPath(dest, destDirectoryPath, destFileName);

	StorageFolder srcFolder{ co_await StorageFolder::GetFolderFromPathAsync(srcDirectoryPath) };
	StorageFolder destFolder{ co_await StorageFolder::GetFolderFromPathAsync(destDirectoryPath) };
	StorageFile file{ co_await srcFolder.GetFileAsync(srcFileName) };

	co_await file.CopyAsync(destFolder, destFileName, NameCollisionOption::FailIfExists);

	callback("");
}
catch (const hresult_error& ex)
{
	hresult result{ ex.code() };
	if (result == 0x80070002) // FileNotFoundException
	{
		callback("Source file not found.");
	}
	callback(winrt::to_string(ex.message()).c_str());
}


// exists
void RNFetchBlob::exists(
	std::string path,
	std::function<void(bool, bool)> callback) noexcept
{
	std::filesystem::path fsPath(path);
	bool doesExist{ std::filesystem::exists(fsPath) };
	bool isDirectory{ std::filesystem::is_directory(fsPath) };

	callback(doesExist, isDirectory);
}


// unlink
winrt::fire_and_forget RNFetchBlob::unlink(
	std::string path,
	std::function<void(std::string, bool)> callback) noexcept
	try
{
	if (std::filesystem::is_directory(path))
	{
		std::filesystem::path unlinkPath(path);
		unlinkPath.make_preferred();
		StorageFolder folder{ co_await StorageFolder::GetFolderFromPathAsync(winrt::to_hstring(unlinkPath.c_str())) };
		co_await folder.DeleteAsync();
	}
	else
	{
		winrt::hstring directoryPath, fileName;
		splitPath(path, directoryPath, fileName);
		StorageFolder folder{ co_await StorageFolder::GetFolderFromPathAsync(directoryPath) };
		auto target{ co_await folder.GetItemAsync(fileName) };
		co_await target.DeleteAsync();
	}
	callback("", true);
}
catch (const hresult_error& ex)
{
	callback(winrt::to_string(ex.message()), false);
}


// lstat
winrt::fire_and_forget RNFetchBlob::lstat(
	std::string path,
	std::function<void(std::string, winrt::Microsoft::ReactNative::JSValueArray&)> callback) noexcept
try
{
	std::filesystem::path directory(path);
	directory.make_preferred();
	StorageFolder targetDirectory{ co_await StorageFolder::GetFolderFromPathAsync(directory.c_str()) };

	winrt::Microsoft::ReactNative::JSValueArray resultsArray;

	auto items{ co_await targetDirectory.GetItemsAsync() };
	for (auto item : items)
	{
		auto properties{ co_await item.GetBasicPropertiesAsync() };

		winrt::Microsoft::ReactNative::JSValueObject itemInfo;

		itemInfo["filename"] = to_string(item.Name());
		itemInfo["path"] = to_string(item.Path());
		itemInfo["size"] = properties.Size();
		itemInfo["type"] = item.IsOfType(StorageItemTypes::Folder) ? "directory" : "file";
		itemInfo["lastModified"] = properties.DateModified().time_since_epoch() / std::chrono::seconds(1) - UNIX_EPOCH_IN_WINRT_SECONDS;

		resultsArray.push_back(std::move(itemInfo));
	}

	callback("", resultsArray);
}
catch (...)
{
	// "Failed to read directory."
	winrt::Microsoft::ReactNative::JSValueArray emptyArray;
	callback("failed to lstat path `" + path + "` because it does not exist or it is not a folder", emptyArray);
}


// stat
winrt::fire_and_forget RNFetchBlob::stat(
	std::string path,
	std::function<void(std::string, winrt::Microsoft::ReactNative::JSValueObject&)> callback) noexcept
try
{
	std::filesystem::path givenPath(path);
	givenPath.make_preferred();
	bool isDirectory{ std::filesystem::is_directory(path) };

	//std::string resultPath{ winrt::to_string(givenPath.c_str()) };
	auto resultPath{ winrt::to_hstring(givenPath.c_str()) };

	// Try to open as folder
	IStorageItem item;
	if (isDirectory) {
		item = co_await StorageFolder::GetFolderFromPathAsync(resultPath);
	}
	else {
		item = co_await StorageFile::GetFileFromPathAsync(resultPath);
	}
	auto properties{ co_await item.GetBasicPropertiesAsync() };
	winrt::Microsoft::ReactNative::JSValueObject fileInfo;
	fileInfo["size"] = properties.Size();
	fileInfo["filename"] = givenPath.filename().string();
	fileInfo["path"] = givenPath.string();
	fileInfo["lastModified"] = winrt::clock::to_time_t(properties.DateModified());;
	fileInfo["type"] = isDirectory ? "directory" : "file";

	callback("", fileInfo);
}
catch (const hresult_error& ex)
{
	winrt::Microsoft::ReactNative::JSValueObject emptyObject;
	callback(winrt::to_string(ex.message()).c_str(), emptyObject);
}


// df
winrt::fire_and_forget RNFetchBlob::df(
	std::function<void(std::string, winrt::Microsoft::ReactNative::JSValueObject&)> callback) noexcept
try
{
	auto localFolder{ Windows::Storage::ApplicationData::Current().LocalFolder() };
	auto properties{ co_await localFolder.Properties().RetrievePropertiesAsync({L"System.FreeSpace", L"System.Capacity"}) };

	winrt::Microsoft::ReactNative::JSValueObject result;
	result["free"] = unbox_value<uint64_t>(properties.Lookup(L"System.FreeSpace"));
	result["total"] = unbox_value<uint64_t>(properties.Lookup(L"System.Capacity"));
	callback("", result);
}
catch (...)
{
	winrt::Microsoft::ReactNative::JSValueObject emptyObject;
	callback("Failed to get storage usage.", emptyObject);
}


winrt::fire_and_forget RNFetchBlob::slice(
	std::string src,
	std::string dest,
	uint32_t start,
	uint32_t end,
	winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept
try
{
	winrt::hstring srcDirectoryPath, srcFileName, destDirectoryPath, destFileName;
	splitPath(src, srcDirectoryPath, srcFileName);
	splitPath(src, destDirectoryPath, destFileName);

	StorageFolder srcFolder{ co_await StorageFolder::GetFolderFromPathAsync(srcDirectoryPath) };
	StorageFolder destFolder{ co_await StorageFolder::GetFolderFromPathAsync(destDirectoryPath) };

	StorageFile srcFile{ co_await srcFolder.GetFileAsync(srcFileName) };
	StorageFile destFile{ co_await destFolder.CreateFileAsync(destFileName, CreationCollisionOption::OpenIfExists) };

	uint32_t length{ end - start };
	Streams::IBuffer buffer;
	Streams::IRandomAccessStream stream{ co_await srcFile.OpenAsync(FileAccessMode::Read) };
	stream.Seek(start);
	stream.ReadAsync(buffer, length, Streams::InputStreamOptions::None);
	co_await FileIO::WriteBufferAsync(destFile, buffer);

	promise.Resolve(dest);
}
catch (...)
{
	promise.Reject("Unable to slice file");
}


IAsyncAction setTimeout(std::chrono::seconds time) {
	co_await time;
}

winrt::fire_and_forget RNFetchBlob::fetchBlob(
	winrt::Microsoft::ReactNative::JSValueObject options,
	std::string taskId,
	std::string method,
	std::wstring url,
	winrt::Microsoft::ReactNative::JSValueObject headers,
	std::string body,
	std::function<void(std::string, std::string, std::string)> callback) noexcept
{
	winrt::Windows::Web::Http::Filters::HttpBaseProtocolFilter filter;
	RNFetchBlobConfig config{ options };
	filter.AllowAutoRedirect(false);
	if (config.trusty)
	{
		filter.IgnorableServerCertificateErrors().Append(Cryptography::Certificates::ChainValidationResult::Untrusted);
	}
	RNFetchBlobState eventState;

	winrt::Windows::Web::Http::HttpClient httpClient{ filter };

	winrt::Windows::Web::Http::HttpMethod httpMethod{ winrt::Windows::Web::Http::HttpMethod::Post() };
	// Delete, Patch, Post, Put, Get, Options, Head
	if (method.compare("DELETE") == 0 || method.compare("delete") == 0)
	{
		httpMethod = winrt::Windows::Web::Http::HttpMethod::Delete();
	}
	else if (method.compare("PUT") == 0 || method.compare("put") == 0)
	{
		httpMethod = winrt::Windows::Web::Http::HttpMethod::Put();
	}
	else if (method.compare("GET") == 0 || method.compare("get") == 0)
	{
		httpMethod = winrt::Windows::Web::Http::HttpMethod::Get();
	}
	else
	{
		callback("Method not supported", "error", "");
		co_return;
	}

	winrt::Windows::Web::Http::HttpRequestMessage requestMessage{ httpMethod, Uri{url} };
	bool pathToFile{ body.rfind(prefix, 0) == 0 };
	if (pathToFile)
	{
		std::string contentPath{ body.substr(prefix.length()) };
		size_t fileLength = contentPath.length();
		bool hasTrailingSlash{ contentPath[fileLength - 1] == '\\' || contentPath[fileLength - 1] == '/' };
		winrt::hstring directoryPath, fileName;
		splitPath(hasTrailingSlash ? contentPath.substr(0, fileLength - 1) : contentPath, directoryPath, fileName);
		StorageFolder folder{ co_await StorageFolder::GetFolderFromPathAsync(directoryPath) };
		StorageFile storageFile{ co_await folder.CreateFileAsync(fileName, CreationCollisionOption::OpenIfExists) };
		IBuffer requestBuffer{ co_await FileIO::ReadBufferAsync(storageFile) };

		winrt::Windows::Web::Http::HttpBufferContent requestContent{ requestBuffer };

		for (auto const& entry : headers)
		{
			if (!requestMessage.Headers().TryAppendWithoutValidation(winrt::to_hstring(entry.first), winrt::to_hstring(entry.second.AsString())))
			{
				requestContent.Headers().TryAppendWithoutValidation(winrt::to_hstring(entry.first), winrt::to_hstring(entry.second.AsString()));
			}
		}
		requestMessage.Content(requestContent);
	}
	else if (!body.empty()) {
		winrt::Windows::Web::Http::HttpStringContent requestString{ winrt::to_hstring(body) };

		for (auto const& entry : headers)
		{
			if (!requestMessage.Headers().TryAppendWithoutValidation(winrt::to_hstring(entry.first), winrt::to_hstring(entry.second.AsString())))
			{
				requestString.Headers().TryAppendWithoutValidation(winrt::to_hstring(entry.first), winrt::to_hstring(entry.second.AsString()));
			}
		}
		requestMessage.Content(requestString);
	}
	else {
		for (auto const& entry : headers)
		{
			requestMessage.Headers().TryAppendWithoutValidation(winrt::to_hstring(entry.first), winrt::to_hstring(entry.second.AsString()));
		}
	}
	
	auto exists{ uploadProgressMap.find(taskId) };
	if (exists != uploadProgressMap.end()) {
		auto progress{ uploadProgressMap[taskId] };
		uint64_t bodySize{ (co_await requestMessage.Content().ReadAsBufferAsync()).Length() };
		auto contentStream{ co_await requestMessage.Content().ReadAsInputStreamAsync() };
		Buffer buffer{ 10 * 1024 };
		uint64_t read{ 0 };

		if (progress.count > -1) {
			uint64_t progressInterval{ bodySize / 100 * progress.count };
			for (;;) {

				buffer.Length(0);
				auto readBuffer = co_await contentStream.ReadAsync(buffer, buffer.Capacity(), InputStreamOptions::None);
				read += readBuffer.Length();

				if (readBuffer.Length() == 0)
				{
					break;
				}

				if (read >= progressInterval) {
					m_reactContext.CallJSFunction(L"RCTDeviceEventEmitter", L"emit", L"RNFetchBlobProgress-upload",
						Microsoft::ReactNative::JSValueObject{
							{ "taskId", taskId },
							{ "written", read },
							{ "total", bodySize },
						});
					read = 0;
				}
			}
		}
		else if (progress.interval > -1) {
			int64_t initialProgressTime{ winrt::clock::now().time_since_epoch().count() / 10000 };
			int64_t currentProgressTime;
			for (;;) {
				buffer.Length(0);

				auto readBuffer = co_await contentStream.ReadAsync(buffer, buffer.Capacity(), InputStreamOptions::None);
				read += readBuffer.Length();

				if (readBuffer.Length() == 0)
				{
					break;
				}

				currentProgressTime = winrt::clock::now().time_since_epoch().count() / 10000;
				if (currentProgressTime - initialProgressTime >= progress.interval) {
					m_reactContext.CallJSFunction(L"RCTDeviceEventEmitter", L"emit", L"RNFetchBlobProgress-upload",
						Microsoft::ReactNative::JSValueObject{
							{ "taskId", taskId },
							{ "written", read },
							{ "total", bodySize },
						});
					initialProgressTime = winrt::clock::now().time_since_epoch().count() / 10000;
				}
			}
		}
	}
	
	std::string error;
	auto cancellationTimer{ setTimeout(config.timeout) };
	cancellationTimer.Completed([weak_this = weak_from_this(), taskId, error](IAsyncAction const& action, AsyncStatus status) {
		if (status == AsyncStatus::Completed) {
			auto strong_this{ weak_this.lock() };
			if (strong_this) {
				strong_this->m_tasks.Cancel(taskId);
				{
					std::scoped_lock lock{ strong_this->m_mutex };
					strong_this->uploadProgressMap.extract(taskId);
					strong_this->downloadProgressMap.extract(taskId);
				}
			}
		}
	});
	try {
		co_await m_tasks.Add(taskId, ProcessRequestAsync(taskId, filter, requestMessage, config, callback, error));
	}
	catch (...) {
	
	}
	if (!error.empty()) {
		if (cancellationTimer.Status() != AsyncStatus::Completed) {
			callback(error, "error", "");
		}
		else {
			callback("RNFetchBlob request timed out", "error", "");
		}
	}

	cancellationTimer.Cancel();
 	m_tasks.Cancel(taskId);
	{
		std::scoped_lock lock{ m_mutex };
		uploadProgressMap.extract(taskId);
		downloadProgressMap.extract(taskId);
	}
}

winrt::fire_and_forget RNFetchBlob::fetchBlobForm(
	winrt::Microsoft::ReactNative::JSValueObject options,
	std::string taskId,
	std::string method,
	std::wstring url,
	winrt::Microsoft::ReactNative::JSValueObject headers,
	winrt::Microsoft::ReactNative::JSValueArray body,
	std::function<void(std::string, std::string, std::string)> callback) noexcept
{
	winrt::hstring boundary{ L"-----" };
	winrt::Windows::Web::Http::Filters::HttpBaseProtocolFilter filter;

	RNFetchBlobConfig config{ options };

	filter.AllowAutoRedirect(false);

	if (config.trusty)
	{
		filter.IgnorableServerCertificateErrors().Append(Cryptography::Certificates::ChainValidationResult::Untrusted);
	}

	winrt::Windows::Web::Http::HttpClient httpClient{ filter };
	
	winrt::Windows::Web::Http::HttpMethod httpMethod{ winrt::Windows::Web::Http::HttpMethod::Post() };
	// Delete, Patch, Post, Put, Get, Options, Head
	if (method.compare("DELETE") == 0 || method.compare("delete") == 0)
	{
		httpMethod = winrt::Windows::Web::Http::HttpMethod::Delete();
	}
	else if (method.compare("PUT") == 0 || method.compare("put") == 0)
	{
		httpMethod = winrt::Windows::Web::Http::HttpMethod::Put();
	}
	else if (method.compare("GET") == 0 || method.compare("get") == 0)
	{
		httpMethod = winrt::Windows::Web::Http::HttpMethod::Get();
	}
	else if (method.compare("POST") != 0 && method.compare("post") != 0)
	{
		callback("Method not supported", "error", "");
		co_return;
	}

	winrt::Windows::Web::Http::HttpRequestMessage requestMessage{ httpMethod, Uri{url} };
	winrt::Windows::Web::Http::HttpMultipartFormDataContent requestContent{ boundary };

	for (auto const& entry : headers)
	{
		if (!requestMessage.Headers().TryAppendWithoutValidation(winrt::to_hstring(entry.first), winrt::to_hstring(entry.second.AsString())))
		{
			requestContent.Headers().TryAppendWithoutValidation(winrt::to_hstring(entry.first), winrt::to_hstring(entry.second.AsString()));
		}
	}

	for (auto& entry : body) {
		auto& items{ entry.AsObject() };

		auto data{ items["data"].AsString() };
		bool pathToFile{ data.rfind(prefix, 0) == 0 };
		if (pathToFile)
		{
			std::string contentPath{ data.substr(prefix.length()) };
			size_t fileLength = contentPath.length();
			bool hasTrailingSlash{ contentPath[fileLength - 1] == '\\' || contentPath[fileLength - 1] == '/' };
			winrt::hstring directoryPath, fileName;
			splitPath(hasTrailingSlash ? contentPath.substr(0, fileLength - 1) : contentPath, directoryPath, fileName);
			StorageFolder folder{ co_await StorageFolder::GetFolderFromPathAsync(directoryPath) };
			StorageFile storageFile = co_await folder.CreateFileAsync(fileName, CreationCollisionOption::OpenIfExists);
			IBuffer requestBuffer{ co_await FileIO::ReadBufferAsync(storageFile) };

			winrt::Windows::Web::Http::HttpBufferContent requestBufferContent{ requestBuffer };

			if (!items["type"].IsNull()) {
				requestBufferContent.Headers().TryAppendWithoutValidation(L"content-type", winrt::to_hstring(items["type"].AsString()));
			}

			auto name{ items["name"].IsNull() ? L"" : winrt::to_hstring(items["name"].AsString()) };
			if (name.size() <= 0) {
				requestContent.Add(requestBufferContent);
				continue;
			}
			auto filename{ items["filename"].IsNull() ? L"" : winrt::to_hstring(items["filename"].AsString()) };
			if (filename.size() <= 0) {
				requestContent.Add(requestBufferContent, name);
			}
			else {
				requestContent.Add(requestBufferContent, name, filename);
			}
		}
		else {
			winrt::Windows::Web::Http::HttpStringContent dataContents{ winrt::to_hstring(data) };
			if (!items["type"].IsNull()) {
				dataContents.Headers().TryAppendWithoutValidation(L"content-type", winrt::to_hstring(items["type"].AsString()));
			}

			auto name{ items["name"].IsNull() ? L"" : winrt::to_hstring(items["name"].AsString()) };
			if (name.size() <= 0) {
				requestContent.Add(dataContents);
				continue;
			}
			auto filename{ items["filename"].IsNull() ? L"" : winrt::to_hstring(items["filename"].AsString()) };
			if (filename.size() <= 0) {
				requestContent.Add(dataContents, name);
			}
			else {
				requestContent.Add(dataContents, name, filename);
			}
		}
	}
	requestMessage.Content(requestContent);

	auto exists{ uploadProgressMap.find(taskId) };
	if (exists != uploadProgressMap.end()) {
		auto progress{ uploadProgressMap[taskId] };
		uint64_t bodySize{ (co_await requestMessage.Content().ReadAsBufferAsync()).Length() };
		auto contentStream{ co_await requestMessage.Content().ReadAsInputStreamAsync() };
		Buffer buffer{ 10 * 1024 };
		uint64_t read{ 0 };

		if (progress.count > -1) {
			uint64_t progressInterval{ bodySize / 100 * progress.count };
			for (;;) {

				buffer.Length(0);
				auto readBuffer = co_await contentStream.ReadAsync(buffer, buffer.Capacity(), InputStreamOptions::None);
				read += readBuffer.Length();

				if (readBuffer.Length() == 0)
				{
					break;
				}

				if (read >= progressInterval) {
					m_reactContext.CallJSFunction(L"RCTDeviceEventEmitter", L"emit", L"RNFetchBlobProgress-upload",
						Microsoft::ReactNative::JSValueObject{
							{ "taskId", taskId },
							{ "written", read },
							{ "total", bodySize },
						});
					read = 0;
				}
			}
		}
		else if (progress.interval > -1) {
			int64_t initialProgressTime{ winrt::clock::now().time_since_epoch().count() / 10000 };
			int64_t currentProgressTime;
			for (;;) {
				buffer.Length(0);
			
				auto readBuffer = co_await contentStream.ReadAsync(buffer, buffer.Capacity(), InputStreamOptions::None);
				read += readBuffer.Length();
				
				if (readBuffer.Length() == 0)
				{
					break;
				}

				currentProgressTime = winrt::clock::now().time_since_epoch().count() / 10000;
				if (currentProgressTime - initialProgressTime >= progress.interval) {
					m_reactContext.CallJSFunction(L"RCTDeviceEventEmitter", L"emit", L"RNFetchBlobProgress-upload",
						Microsoft::ReactNative::JSValueObject{
							{ "taskId", taskId },
							{ "written", read },
							{ "total", bodySize },
						});
					initialProgressTime = winrt::clock::now().time_since_epoch().count() / 10000;
				}
			}
		}
	}
	
	std::string error;
	auto cancellationTimer{ setTimeout(config.timeout) };
	cancellationTimer.Completed([weak_this = weak_from_this(), taskId, error](IAsyncAction const& action, AsyncStatus status) {
		if (status == AsyncStatus::Completed) {
			auto strong_this{ weak_this.lock() };
			if (strong_this) {
				strong_this->m_tasks.Cancel(taskId);
				{
					std::scoped_lock lock{ strong_this->m_mutex };
					strong_this->uploadProgressMap.extract(taskId);
					strong_this->downloadProgressMap.extract(taskId);
				}
			}
		}
	});
	try {
		co_await m_tasks.Add(taskId, ProcessRequestAsync(taskId, filter, requestMessage, config, callback, error));
	}
	catch (...) {

	}
	if (!error.empty()) {
		if (cancellationTimer.Status() != AsyncStatus::Completed) {
			callback(error, "error", "");
		}
		else {
			callback("RNFetchBlob request timed out", "error", "");
		}
	}

	cancellationTimer.Cancel();
	m_tasks.Cancel(taskId);
	{
		std::scoped_lock lock{ m_mutex };
		uploadProgressMap.extract(taskId);
		downloadProgressMap.extract(taskId);
	}
}

void RNFetchBlob::enableProgressReport(
	std::string taskId,
	int interval,
	int count) noexcept {
	RNFetchBlobProgressConfig config{ count, interval };
	std::scoped_lock lock{ m_mutex };
	downloadProgressMap.try_emplace(taskId, config);
}

// enableUploadProgressReport
void RNFetchBlob::enableUploadProgressReport(
	std::string taskId,
	int interval,
	int count) noexcept {
	RNFetchBlobProgressConfig config{ count, interval };
	std::scoped_lock lock{ m_mutex };
	uploadProgressMap.try_emplace(taskId, config);
}

// cancelRequest
void RNFetchBlob::cancelRequest(
	std::string taskId,
	std::function<void(std::string, std::string)> callback) noexcept
try
{
	m_tasks.Cancel(taskId);
	callback("", taskId);
}
catch (const hresult_error& ex)
{
	callback(winrt::to_string(ex.message()), "");
}

winrt::fire_and_forget RNFetchBlob::removeSession(
	winrt::Microsoft::ReactNative::JSValueArray paths,
	std::function<void(std::string)> callback) noexcept
try
{
	for (auto& path : paths)
	{
		std::filesystem::path toDelete{ path.AsString() };
		toDelete.make_preferred();
		StorageFile file{ co_await StorageFile::GetFileFromPathAsync(winrt::to_hstring(toDelete.c_str())) };
		co_await file.DeleteAsync();
	}
	callback("");
}
catch (const hresult_error& ex)
{
	callback(winrt::to_string(ex.message()).c_str());
}

void RNFetchBlob::closeStream(
	std::string streamId,
	std::function<void(std::string)> callback) noexcept
try
{
	auto stream{ m_streamMap.find(streamId)->second };
	stream.streamInstance.Close();
	m_streamMap.extract(streamId);
	callback("");
}
catch (const hresult_error& ex)
{
	callback(winrt::to_string(ex.message()).c_str());
}


void RNFetchBlob::splitPath(const std::string& fullPath, winrt::hstring& directoryPath, winrt::hstring& fileName) noexcept
{
	std::filesystem::path path{ fullPath };
	path.make_preferred();

	directoryPath = path.has_parent_path() ? winrt::to_hstring(path.parent_path().c_str()) : L"";
	fileName = path.has_filename() ? winrt::to_hstring(path.filename().c_str()) : L"";
}

void RNFetchBlob::splitPath(const std::wstring& fullPath, winrt::hstring& directoryPath, winrt::hstring& fileName) noexcept
{
	std::filesystem::path path{ fullPath };
	path.make_preferred();

	directoryPath = path.has_parent_path() ? winrt::to_hstring(path.parent_path().c_str()) : L"";
	fileName = path.has_filename() ? winrt::to_hstring(path.filename().c_str()) : L"";
}

winrt::Windows::Foundation::IAsyncAction RNFetchBlob::ProcessRequestAsync(
	const std::string& taskId,
	const winrt::Windows::Web::Http::Filters::HttpBaseProtocolFilter& filter,
	winrt::Windows::Web::Http::HttpRequestMessage& httpRequestMessage,
	RNFetchBlobConfig& config,
	std::function<void(std::string, std::string, std::string)> callback,
	std::string& error) noexcept
try
{
	winrt::Windows::Web::Http::HttpClient httpClient{filter};

	winrt::Windows::Web::Http::HttpResponseMessage response{ co_await httpClient.SendRequestAsync(httpRequestMessage, winrt::Windows::Web::Http::HttpCompletionOption::ResponseHeadersRead) };
	
	RNFetchBlobState eventState;

	auto status{ static_cast<int>(response.StatusCode()) };
	if (config.followRedirect) {
		while (status >= 300 && status < 400) {
			auto redirect{ response.Headers().Location().ToString() };
			eventState.redirects.push_back(Microsoft::ReactNative::JSValue(winrt::to_string(redirect)));
			httpRequestMessage.RequestUri(Uri{ redirect });
			response = co_await httpClient.SendRequestAsync(httpRequestMessage, winrt::Windows::Web::Http::HttpCompletionOption::ResponseHeadersRead);
			status = static_cast<int>(response.StatusCode());
		}
	}
	
	eventState.status = static_cast<int>(response.StatusCode());

	for (const auto header : response.Content().Headers().GetView()) {
		eventState.headers[winrt::to_string(header.Key())] = winrt::to_string(header.Value());
	}

	if (response.Content().Headers().ContentType() != nullptr) {
		eventState.respType = winrt::to_string(response.Content().Headers().ContentType().ToString());
	}

	eventState.state = winrt::to_string(response.ReasonPhrase());

	m_reactContext.CallJSFunction(L"RCTDeviceEventEmitter", L"emit", L"RNFetchBlobState",
		Microsoft::ReactNative::JSValueObject{
			{ "taskId", taskId },
			{ "state", eventState.state },
			{ "headers", std::move(eventState.headers) },
			{ "redirects", std::move(eventState.redirects) },
			{ "respType", eventState.respType },
			{ "status", eventState.status },
			{ "timeout", false },
		});

	IReference<uint64_t> contentLength{ response.Content().Headers().ContentLength() };

	IOutputStream outputStream;
	bool writeToFile{ config.fileCache || !config.path.empty() };

	if (writeToFile)
	{
		if (config.path.empty())
		{
			config.path = winrt::to_string(ApplicationData::Current().TemporaryFolder().Path()) + "\\RNFetchBlobTmp_" + taskId;
			if (config.appendExt.length() > 0)
			{
				config.path += "." + config.appendExt;
			}
		}
		std::filesystem::path path{ config.path };
		StorageFolder storageFolder{ co_await StorageFolder::GetFolderFromPathAsync( path.parent_path().wstring()) };
		StorageFile storageFile{ co_await storageFolder.CreateFileAsync(path.filename().wstring(), CreationCollisionOption::FailIfExists) };
		IRandomAccessStream stream{ co_await storageFile.OpenAsync(FileAccessMode::ReadWrite) };
		outputStream = stream.GetOutputStreamAt(0) ;
	}

	auto contentStream{ co_await response.Content().ReadAsInputStreamAsync() };
	Buffer buffer{ 10 * 1024 };
	uint64_t read{ 0 };
	uint64_t totalRead{ 0 };

	RNFetchBlobProgressConfig progressInfo;
	uint64_t progressInterval{ 0 };

	std::stringstream chunkStream;
	std::stringstream resultOutput;

	std::string readContents{""};

	auto exists{ downloadProgressMap.find(taskId) };
	if (exists != downloadProgressMap.end() && contentLength.Type() == PropertyType::UInt64) {
		progressInfo = downloadProgressMap[taskId];

		if (progressInfo.count > -1) {
			progressInterval = contentLength.Value() / 100 * progressInfo.count;
		}
	}

	int64_t initialProgressTime{ winrt::clock::now().time_since_epoch().count() / 10000 };
	int64_t currentProgressTime;

	for (;;)
	{
		buffer.Length(0);
		auto readBuffer{ co_await contentStream.ReadAsync(buffer, buffer.Capacity(), InputStreamOptions::None) };

		read += readBuffer.Length();
		totalRead += read;

		if (readBuffer.Length() == 0)
		{
			break;
		}
		
		readContents = winrt::to_string(CryptographicBuffer::EncodeToBase64String(readBuffer));

		if (writeToFile) {
			co_await outputStream.WriteAsync(readBuffer);
		}
		else {
			resultOutput << readContents;
		}

		if (progressInfo.count > -1 || progressInfo.interval > -1) {
			chunkStream << readContents;

			currentProgressTime = winrt::clock::now().time_since_epoch().count() / 10000;
			if ((currentProgressTime - initialProgressTime >= progressInfo.interval && progressInfo.interval > -1) ||
				(totalRead >= progressInterval && progressInfo.count > -1)) {
				m_reactContext.CallJSFunction(L"RCTDeviceEventEmitter", L"emit", L"RNFetchBlobProgress",
					Microsoft::ReactNative::JSValueObject{
						{ "taskId", taskId },
						{ "written", int64_t(totalRead) },
						{ "total", contentLength.Type() == PropertyType::UInt64 ?
									Microsoft::ReactNative::JSValue(contentLength.Value()) :
									Microsoft::ReactNative::JSValue{nullptr} },
						{ "chunk", chunkStream.str() },
					});
				chunkStream.clear();
				initialProgressTime = winrt::clock::now().time_since_epoch().count() / 10000;
				if (progressInfo.count > -1) {
					read = 0;
				}
			}
		}
	}

	if (writeToFile) {
		callback("", "path", config.path);
	}
	else {
		callback("", "result", resultOutput.str());
	}
}
catch (const hresult_error& ex)
{
	error = winrt::to_string(ex.message().c_str());
	//callback(winrt::to_string(ex.message().c_str()), "error", "");
}
catch (...) {
	co_return;
}


RNFetchBlobStream::RNFetchBlobStream(Streams::IRandomAccessStream& _streamInstance, EncodingOptions _encoding) noexcept
	: streamInstance{ std::move(_streamInstance) }
	, encoding{ _encoding }
{
}


#include "pch.h"
#include "ReactPackageProvider.h"
#include "ReactPackageProvider.g.cpp"

#include "RNFetchBlob.h"

using namespace winrt::Microsoft::ReactNative;

namespace winrt::RNFetchBlob::implementation {

void ReactPackageProvider::CreatePackage(IReactPackageBuilder const &packageBuilder) noexcept {
  AddAttributedModules(packageBuilder);
}

} // namespace winrt::RNFetchBlob::implementation

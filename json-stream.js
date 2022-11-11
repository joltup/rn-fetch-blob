import Oboe from "oboe";
import XMLHttpRequest from "./polyfill/XMLHttpRequest";
import URIUtil from "./utils/uri";

const OboeExtended = (arg: string | Object) => {
	window.location = "";

	if (!window.XMLHttpRequest.isRNFBPolyfill) {
		window.XMLHttpRequest = XMLHttpRequest;
		console.warn(
			"Use JSONStream will automatically replace window.XMLHttpRequest with RNFetchBlob.polyfill.XMLHttpRequest. " +
				"You are seeing this warning because you did not replace it manually."
		);
	}

	if (typeof arg === "string") {
		if (URIUtil.isFileURI(arg)) {
			arg = {
				url: "JSONStream://" + arg,
				headers: { noCache: true },
			};
		} else arg = "JSONStream://" + arg;
	} else if (typeof arg === "object") {
		let headers = arg.headers || {};
		if (URIUtil.isFileURI(arg.url)) {
			headers.noCache = true;
		}
		arg = Object.assign(arg, {
			url: "JSONStream://" + arg.url,
			headers,
		});
	}
	return Oboe(arg);
};

export default OboeExtended;

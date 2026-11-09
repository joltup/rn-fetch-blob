// @flow
const CANCELED_FETCH_ERROR_NAME = 'ReactNativeBlobUtilCanceledFetch';

class CanceledFetchError extends Error {
    code: string;

    constructor(message) {
        super(message);
        this.name = CANCELED_FETCH_ERROR_NAME;
        this.code = 'ECANCELED';
    }
}

export default CanceledFetchError;
// ==UserScript==
// @name         Godot Web File Manager
// @namespace    mailto:sisilicon28@gmail.com
// @version      1.0
// @description  Adds a File Manager to the Godot Game Engine Web Editor to manage projects and Godot's files more effectively.
// @author       SIsilicon
// @match        https://editor.godotengine.org/releases/*
// @require      https://raw.githubusercontent.com/Stuk/jszip/master/dist/jszip.min.js
// @icon         https://www.google.com/s2/favicons?domain=tampermonkey.net
// @grant        none
// ==/UserScript==

// TODO: Prevent the deleting, cutting or renaming of a downloading/uploading folder.
//       Show upload progress of folders.
//       Add a '+' icon to add/upload items to the current directory.
//       Mark certain html elements as non translatable.
//       Convert all relevant file system methods to accept transactions through parameters.

const fileWindows = [];

const extToMime = {
    ".bmp": "image/bmp",
    ".css": "text/css",
    ".csv": "text/csv",
    ".htm": "text/html",
    ".html": "text/html",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".json": "application/json",
    ".mp3": "audio/mpeg",
    ".mpeg": "video/mpeg",
    ".ogg": "audio/ogg",
    ".ogv": "video/ogg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".txt": "text/plain",
    ".wav": "audio/wav",
    ".webm": "video/webm",
    ".webp": "video/webm",
    ".xml": "text/xml",
};

function createUUID() {
    let dt = new Date().getTime();
    let uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        let r = (dt + Math.random() * 16) % 16 | 0;
        dt = Math.floor(dt / 16);
        return (c == 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
    return uuid;
}

function range(start, end) {
    let reversed = false;
    if (end - start < 0) {
        const temp = start;
        start = end;
        end = temp;
        reversed = true;
    }

    let arr = Array(end - start + 1).fill().map((_, idx) => start + idx);
    if (reversed) {
        return arr.reverse();
    }
    return arr;
}

function parentDir(path) {
    return path.substr(0, path.includes('/') ? path.lastIndexOf('/') : 0);
}

// Note: does not handle going UP the hierarchy.
function relativeTo(path, dir) {
    return path.replace(dir, '');
}

function getFileName(path, withoutExtension = false) {
    let name = path;
    if (path.includes('/')) {
        name = path.substr(path.lastIndexOf('/') + 1);
    }
    if (withoutExtension && name.includes('.')) {
        name = name.substr(0, name.lastIndexOf('.'));
    }
    return name;
}

function getFileExtension(path) {
    if (path.includes('.')) {
        return path.substr(path.lastIndexOf('.'));
    }
    return '';
}

// Appends a number to the file in case it already exists.
function adjustFileName(path) {
    let i = 0;
    let dir = parentDir(path);
    let folderList = fileSystem.listdir(dir);
    while (folderList.includes(i == 0 ? path : `${dir}/${getFileName(path, true)}(${i})${getFileExtension(path)}`)) {
        i++;
    }
    if (i != 0) {
        path = `${dir}/${getFileName(path, true)}(${i})${getFileExtension(path)}`;
    }
    return path;
}

function createTransaction(type) {
    return indexedDB.transaction('FILE_DATA', type);
}

function dispatchFileEvent(type, path, data = {}) {
    const detail = { path: path, dir: parentDir(path) };
    for (const key in data) {
        detail[key] = data[key];
    }
    const event = new CustomEvent(type, { detail: detail });
    for (const win of fileWindows) {
        win.document.dispatchEvent(event);
        for (const entry of win.fileEntries) {
            entry.buttonEl.dispatchEvent(event);
        }
    }
}

const icons = {
    //add: '',
    prev: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCA4IDE2IiB3aWR0aD0iOCI+DQogICAgICAgICAgICA8cGF0aCBkPSJtNiAxMDM4LjQtNCA2IDQgNiIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZTBlMGUwIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiDQogICAgICAgICAgICAgICAgc3Ryb2tlLXdpZHRoPSIyIiB0cmFuc2Zvcm09InRyYW5zbGF0ZSgwIC0xMDM2LjQpIiAvPg0KICAgICAgICA8L3N2Zz4=',
    next: 'data:image/svg+xml;base64,ICAgICAgICA8c3ZnIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgaGVpZ2h0PSIxNiIgdmlld0JveD0iMCAwIDggMTYiIHdpZHRoPSI4Ij4NCiAgICAgICAgICAgIDxwYXRoIGQ9Im0yIDEwMzguNCA0IDYtNCA2IiBmaWxsPSJub25lIiBzdHJva2U9IiNlMGUwZTAiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCINCiAgICAgICAgICAgICAgICBzdHJva2Utd2lkdGg9IjIiIHRyYW5zZm9ybT0idHJhbnNsYXRlKDAgLTEwMzYuNCkiIC8+DQogICAgICAgIDwvc3ZnPg0K',
    up: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgd2lkdGg9IjE2Ij4NCiAgICAgICAgICAgIDxwYXRoDQogICAgICAgICAgICAgICAgZD0ibTguMDAwMDggMTA0OS40MDIyYTEgMSAwIDAgMCAuNjkzMzYtLjI5MSAxIDEgMCAwIDAgMC0xLjQxNDFsLTIuMjkzLTIuMjkzaDQuNTg1OWMuNTUyMjggMCAxLS40NDc3IDEtMXMtLjQ0NzcyLTEtMS0xaC00LjU4NTlsMi4yOTMtMi4yOTNhMSAxIDAgMCAwIDAtMS40MTQxIDEgMSAwIDAgMCAtMS40MTQxIDBsLTQgNGExLjAwMDEgMS4wMDAxIDAgMCAwIDAgMS40MTQxbDQgNGExIDEgMCAwIDAgLjcyMDcuMjkxeiINCiAgICAgICAgICAgICAgICBmaWxsPSIjZTBlMGUwIiBmaWxsLW9wYWNpdHk9Ii45OTYwOCIgdHJhbnNmb3JtPSJtYXRyaXgoMCAxIC0xIDAgMTA1Mi40MDIxIC0uMDAwMDQpIiAvPg0KICAgICAgICA8L3N2Zz4=',
    refresh: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgd2lkdGg9IjE2Ij4NCiAgICAgICAgICAgIDxnIGZpbGw9IiNlMGUwZTAiIGZpbGwtb3BhY2l0eT0iLjk5NjA4IiB0cmFuc2Zvcm09InRyYW5zbGF0ZSgwIC0xMDM2LjQpIj4NCiAgICAgICAgICAgICAgICA8cGF0aA0KICAgICAgICAgICAgICAgICAgICBkPSJtOSAyYTYgNiAwIDAgMCAtNiA2aDJhNCA0IDAgMCAxIDQtNCA0IDQgMCAwIDEgNCA0IDQgNCAwIDAgMSAtNCA0djJhNiA2IDAgMCAwIDYtNiA2IDYgMCAwIDAgLTYtNnoiDQogICAgICAgICAgICAgICAgICAgIHRyYW5zZm9ybT0idHJhbnNsYXRlKDAgMTAzNi40KSIgLz4NCiAgICAgICAgICAgICAgICA8cGF0aCBkPSJtNC4xMTggMTA0OC4zLTEuNjc3MS0uOTY4My0xLjY3NzEtLjk2ODIgMS42NzcxLS45NjgzIDEuNjc3MS0uOTY4Mi0uMDAwMDAwMSAxLjkzNjV6Ig0KICAgICAgICAgICAgICAgICAgICB0cmFuc2Zvcm09Im1hdHJpeCgwIC0xLjE5MjYgMS41NDkyIDAgLTE2MTcgMTA0OS4zKSIgLz4NCiAgICAgICAgICAgIDwvZz4NCiAgICAgICAgPC9zdmc+',
    upload: 'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZlcnNpb249IjEuMSIgdmlld0JveD0iMCAwIDMyIDMyIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPgogPHBhdGggZD0ibTMuMTU0NyAyNy41N2MtMi44OTItMC4wNDA0NC0yLjg5MiA0LjI3MDMgMCA0LjIyOTloMjUuNjYyYzIuODkyIDAuMDQwNDYgMi44OTItNC4yNzAzIDAtNC4yMjk5em0xMi44MzEtMS44Mzk5YzEuMTc5NSAwIDIuMTM1NS0wLjk0NTU0IDIuMTM1NS0yLjExMnYtMTUuMTAzbDQuNzM4MyA1Ljg1NzRjMC43MzY4NCAwLjkxMTc1IDIuMDgxNyAxLjA1OTUgMy4wMDMgMC4zMyAwLjkxOTM0LTAuNzI4NDIgMS4wNjg2LTIuMDU1NCAwLjMzMzY3LTIuOTY1OWwtOC41NDIxLTEwLjU2Yy0wLjQwMjkzLTAuNTAwMzMtMS4wMTMzLTAuNzk2MTEtMS42Ni0wLjc5NjExLTAuNjUyNTktMC4wMDE4OTc0LTEuMjcwMSAwLjI5MTM1LTEuNjc2NyAwLjc5NjExbC04LjU0MjEgMTAuNTZjLTAuNzM0OTQgMC45MTA0OC0wLjU4NTY0IDIuMjM3NCAwLjMzMzY3IDIuOTY1OSAwLjkyMTMzIDAuNzI5NDggMi4yNjYyIDAuNTgxNzUgMy4wMDMtMC4zM2w0LjczODMtNS44NTc0djE1LjEwM2MwIDEuMTY2NSAwLjk1NjA1IDIuMTEyIDIuMTM1NSAyLjExMnoiIGZpbGw9IiNlMGUwZTAiIGZpbGwtb3BhY2l0eT0iLjk5NjA4IiBzdHJva2Utd2lkdGg9IjIuMTI2NyIvPgo8L3N2Zz4K',
    download: 'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZlcnNpb249IjEuMSIgdmlld0JveD0iMCAwIDMyIDMyIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPgogPHBhdGggZD0ibTMuMTU0NyAyNy41N2MtMi44OTItMC4wNDA0NC0yLjg5MiA0LjI3MDMgMCA0LjIyOTloMjUuNjYyYzIuODkyIDAuMDQwNDYgMi44OTItNC4yNzAzIDAtNC4yMjk5em0xMi44MzEtMjcuMjA3Yy0xLjE4MTEgMC0yLjEzODUgMC45NDY4Ni0yLjEzODUgMi4xMTQ5djE1LjEyNGwtNC43NDQ5LTUuODY1NmMtMC43Mzc4Ny0wLjkxMzAyLTIuMDg0Ny0xLjA2MS0zLjAwNzItMC4zMzA0Ni0wLjkyMDYzIDAuNzI5NDQtMS4wNzAxIDIuMDU4My0wLjMzNDE0IDIuOTdsOC41NTQgMTAuNTc1YzAuNDAzNDkgMC41MDEwMyAxLjAxNDcgMC43OTcyMyAxLjY2MjMgMC43OTcyMyAwLjY1MzUxIDAuMDAxOSAxLjI3MTktMC4yOTE3NiAxLjY3OTEtMC43OTcyM2w4LjU1NC0xMC41NzVjMC43MzU5Ny0wLjkxMTc2IDAuNTg2NDYtMi4yNDA2LTAuMzM0MTQtMi45Ny0wLjkyMjYyLTAuNzMwNS0yLjI2OTQtMC41ODI1Ni0zLjAwNzIgMC4zMzA0NmwtNC43NDQ5IDUuODY1NnYtMTUuMTI0YzAtMS4xNjgxLTAuOTU3MzktMi4xMTQ5LTIuMTM4NS0yLjExNDl6IiBmaWxsPSIjZTBlMGUwIiBmaWxsLW9wYWNpdHk9Ii45OTYwOCIgc3Ryb2tlLXdpZHRoPSIyLjEyNjciLz4KPC9zdmc+Cg==',
    folder: 'data:image/svg+xml;base64,PHN2ZyBoZWlnaHQ9IjMyIiB2aWV3Qm94PSIwIDAgMzIgMzIiIHdpZHRoPSIzMiIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJtNiAxMDI1LjRjLTEuMTA0NiAwLTIgLjg5NTQtMiAydjE4LjVoLjA2NTQzYy4yMjc4Mi44ODIzIDEuMDIzMyAxLjQ5OTEgMS45MzQ2IDEuNWgyMGMxLjEwNDYgMCAyLS44OTU0IDItMnYtMTRjMC0xLjEwNDYtLjg5NTQzLTItMi0yaC04bC0xLTJjLS40OTM5OC0uOTg4LS44OTU0My0yLTItMnoiIGZpbGw9IiNlMGUwZTAiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoMCAtMTAyMC40KSIvPjwvc3ZnPgo=',
    file: 'data:image/svg+xml;base64,PHN2ZyBoZWlnaHQ9IjMyIiB2aWV3Qm94PSIwIDAgMzIgMzIiIHdpZHRoPSIzMiIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJtNSAxYy0xLjY0NDcgMC0zIDEuMzU1My0zIDN2MjRjMCAxLjY0NDcgMS4zNTUzIDMgMyAzaDIyYzEuNjQ0NyAwIDMtMS4zNTUzIDMtM3YtMTYuODA5Yy0uMDAwMDUxLS4yNjUyLS4xMDU0My0uNTE5NTItLjI5Mjk3LS43MDcwM2wtOS4xODE2LTkuMTg5NWMtLjE4NzE5LS4xODgyNS0uNDQxNTUtLjI5NDM1LS43MDcwMy0uMjk0OTJ6bTAgMmgxNHY2YzAgMS42NDQ3IDEuMzU1MyAzIDMgM2g2djE2YzAgLjU3MTMtLjQyODY4IDEtMSAxaC0yMmMtLjU3MTMzIDAtMS0uNDI4Ny0xLTF2LTI0YzAtLjU3MTMuNDI4NjctMSAxLTF6IiBmaWxsPSIjZmZmIiBmaWxsLW9wYWNpdHk9Ii41ODgyNCIgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoMCAtLjAwMDAxNykiLz48L3N2Zz4K',
}

const fileSystem = {
    root: '/home/web_user',
    map: new Map(),

    isDir: function(dir) {
        return this.map.has(dir);
    },
    ensureDirExists: function(dir) {
        if (!this.isDir(dir)) {
            this.map.set(dir, []);
        }
    },

    listdir: function(dir, recursive = false) {
        let files = [];
        if (this.isDir(dir)) {
            for (const child of this.map.get(dir)) {
                files = [...files, child];
                if (recursive) {
                    files = [...files, ...this.listdir(child, recursive)];
                }
            }
        }
        return files;
    },

    refresh: function() {
        return new Promise((resolve, reject) => {
            const oldFileMap = new Map(this.map);
            this.map.clear();
            const transaction = indexedDB.transaction('FILE_DATA', 'readonly');
            const file_data = transaction.objectStore('FILE_DATA');
            file_data.openCursor().onsuccess = ev => {
                const cursor = ev.target.result;
                if (cursor) {
                    const file = cursor.key;
                    const dir = parentDir(file);
                    this.ensureDirExists(dir);
                    this.map.get(dir).push(file);
                    if (cursor.value.mode == 16893) {
                        this.ensureDirExists(file);
                    }
                    cursor.continue();
                }
            }
            transaction.oncomplete = ev => {
                resolve();
            }
            transaction.onerror = ev => {
                this.map = oldFileMap;
                console.error(`Reloading the filemap failed due to error: ${ev.target.error}`);
                reject();
            }
        });
    },

    mkdir: function(dir, trans) {
        return new Promise((resolve, reject) => {
            if (!this.isDir(parentDir(dir))) {
                reject();
                return;
            } else if (this.isDir(dir)) {
                resolve();
                return;
            }

            const transaction = trans || createTransaction('readwrite');
            const file_data_store = transaction.objectStore('FILE_DATA');
            const request = file_data_store.put({
                timestamp: new Date(),
                mode: 16893
            }, dir);
            request.onerror = reject;
            request.onsuccess = ev => {
                this.ensureDirExists(dir);
                this.map.get(parentDir(dir)).push(dir);
                resolve();
            }
        });
    },

    mkdirs: function(dir, trans) {
        const dirs = [];
        while (dir && !this.isDir(dir)) {
            dirs.push(dir);
            dir = parentDir(dir);
        }
        dirs.reverse();

        return new Promise((resolve, reject) => {
            if (!dirs.length) {
                resolve();
                return;
            }

            const transaction = trans || createTransaction('readwrite');
            const file_data_store = transaction.objectStore('FILE_DATA');
            const promises = [];
            for (const dir of dirs) {
                promises.push(new Promise((resolve, reject) => {
                    const request = file_data_store.put({
                        timestamp: new Date(),
                        mode: 16893
                    }, dir);
                    request.dir = dir;
                    request.onsuccess = ev => {
                        this.ensureDirExists(ev.target.dir);
                        if (!this.map.get(parentDir(ev.target.dir)).includes(ev.target.dir)) {
                            this.map.get(parentDir(ev.target.dir)).push(ev.target.dir);
                        }
                        resolve();
                    }
                }));
            }

            if (trans) {
                return Promise.all(promises);
            } else {
                transaction.oncomplete = resolve;
                transaction.onerror = reject;
            }
        });
    },

    addfile: function(file, dir, trans) {
        const filePath = adjustFileName(dir + '/' + file.name);
        return new Promise((resolve, reject) => {
            if (!this.isDir(dir)) {
                reject();
                return;
            }

            const reader = new FileReader();
            reader.readAsArrayBuffer(file);
            reader.onerror = reject;
            reader.onload = () => {
                const transaction = trans || createTransaction('readwrite');
                const file_data_store = transaction.objectStore('FILE_DATA');
                const request = file_data_store.put({
                    timestamp: file.lastModifiedDate,
                    mode: 33206,
                    contents: new Int8Array(reader.result)
                }, filePath);
                request.onerror = reject;
                request.onsuccess = ev => {
                    this.map.get(parentDir(filePath)).push(filePath);
                    resolve();
                }
            }
        });
    },

    rename: function(src, dst, trans) {
        return new Promise((resolve, r1eject) => {
            const files = [src, ...this.listdir(src, true)];
            const transaction = trans || createTransaction('readwrite');
            const file_data_store = transaction.objectStore('FILE_DATA');
            const promises = [];
            for (const file_path of files) {
                promises.push(new Promise((resolve, reject) => {
                    const get_request = file_data_store.get(file_path);
                    get_request.file_path = file_path;
                    get_request.onsuccess = ev => {
                        const file_data = ev.target.result;
                        const file_path = ev.target.file_path;
                        let new_path = dst;
                        if (file_path != src) {
                            new_path = dst + relativeTo(file_path, src);
                        }
                        const put_request = file_data_store.put(file_data, new_path);
                        put_request.onsuccess = () => {
                            this.ensureDirExists(parentDir(new_path));
                            this.map.get(parentDir(new_path)).push(new_path);
                            if (file_data.mode == 16893) {
                                this.ensureDirExists(new_path);
                            }

                            const del_request = file_data_store.delete(file_path);
                            del_request.onsuccess = () => {
                                let dir = this.map.get(parentDir(file_path));
                                if (dir) {
                                    dir.splice(dir.indexOf(file_path), 1);
                                }
                                if (file_data.mode == 16893) {
                                    this.map.delete(file_path);
                                }
                                resolve();
                            }
                            del_request.onerror = reject;
                        }
                        put_request.onerror = reject;
                    }
                    get_request.onerror = reject;
                }));
            }

            if (trans) {
                return Promise.all(promises);
            } else {
                transaction.oncomplete = resolve;
                transaction.onerror = ev => {
                    console.error(`Renaming of ${src} failed due to error: ${ev.target.error}`);
                    reject();
                }
            }
        });
    },

    copy: function(src, dst) {
        return new Promise((resolve, reject) => {
            const files = [src, ...this.listdir(src, true)];
            const transaction = indexedDB.transaction('FILE_DATA', 'readwrite');
            const file_data_store = transaction.objectStore('FILE_DATA');
            for (const file_path of files) {
                const get_request = file_data_store.get(file_path);
                get_request.file_path = file_path;
                get_request.onsuccess = ev => {
                    const file_data = ev.target.result;
                    const file_path = ev.target.file_path;
                    let new_path = dst;
                    if (file_path != src) {
                        new_path = dst + relativeTo(file_path, src);
                    }
                    const put_request = file_data_store.put(file_data, new_path);
                    put_request.onsuccess = () => {
                        this.ensureDirExists(parentDir(new_path));
                        this.map.get(parentDir(new_path)).push(new_path);
                        if (file_data.mode == 16893) {
                            this.ensureDirExists(new_path);
                        }
                    }
                }
            }
            transaction.oncomplete = ev => {
                resolve();
            }
            transaction.onerror = ev => {
                console.error(`Copying of ${src} failed due to error: ${ev.target.error}`);
                reject();
            }
        });
    },

    remove: function(path) {
        return new Promise((resolve, reject) => {
            let paths = [path, ...this.listdir(path, true)];

            const transaction = indexedDB.transaction('FILE_DATA', 'readwrite');
            const file_data_store = transaction.objectStore('FILE_DATA');
            for (const path of paths) {
                const del_request = file_data_store.delete(path);
                del_request.path = path;
                del_request.onsuccess = ev => {
                    const path = ev.target.path;
                    if (this.isDir(path)) {
                        this.map.delete(path);
                    }
                    let dir = this.map.get(parentDir(path));
                    if (dir) {
                        dir.splice(dir.indexOf(path), 1);
                    }
                }
            }
            transaction.oncomplete = ev => {
                resolve();
            }
            transaction.onerror = ev => {
                console.error(`Deleting of ${path} failed due to error: ${ev.target.error}`);
                reject();
            }
        });
    },

    download: function(file, win = window, progressCallback = () => {}) {
        const zipping = this.isDir(file);
        const filesToProcess = [file, ...this.listdir(file, true)];

        const downloadBlob = function(blob, name) {
            let link = win.document.getElementById('download-element');
            if (link == null) {
                link = win.document.createElement('a');
                link.id = 'download-element';
            }
            link.href = win.URL.createObjectURL(blob);
            link.download = getFileName(name);
            link.click();
        }

        return new Promise((resolve, reject) => {
            const filesToZip = new Map();
            const transaction = indexedDB.transaction('FILE_DATA', 'readonly');
            const file_data_store = transaction.objectStore('FILE_DATA');
            for (const file of filesToProcess) {
                const request = file_data_store.get(file);
                request.file = file;
                request.onsuccess = ev => {
                    if (ev.target.result.mode == 16893) {
                        return;
                    }

                    const buffer = ev.target.result.contents.buffer;
                    if (zipping) {
                        filesToZip.set(ev.target.file, buffer);
                    } else {
                        let ext = getFileExtension(ev.target.file).slice(1);
                        let blob = new Blob([buffer], { type: extToMime[ext] == 'undefined' ? extToMime.txt : extToMime[ext] });
                        downloadBlob(blob, ev.target.file);
                    }
                }
            }

            transaction.oncomplete = ev => {
                if (zipping) {
                    let jszip = new JSZip();
                    filesToZip.forEach((value, key) => {
                        let relative = relativeTo(key, file).substring(1);
                        jszip.file(relative, value);
                    });
                    jszip.generateAsync({ type: 'blob' }, (meta) => {
                        progressCallback(meta.percent / 100.0, file);
                    }).then(blob => {
                        downloadBlob(blob, getFileName(file) + '.zip');
                        resolve();
                    }).catch(() => {
                        reject();
                    });
                } else {
                    resolve();
                }
            }

            transaction.onerror = ev => {
                console.error(`Downloading of (${file}) failed due to error: ` + ev.target.error);
                reject();
            }
        })
    },
};

const FileManager_style = (`
body {
    color: #e0e0e0;
    overflow: none;
    display: flex;
    flex-direction: column;
    height: 100%;
}

table {
    width: 100%;
}

.medium {
    width: 2rem;
    height: 2rem;
}

.small {
    width: 1rem;
    height: 1rem;
}

.btn-flat {
    color: #e0e0e0;
    background-color: transparent;
    border: none;
    background-repeat: no-repeat;
    background-size: contain;
    background-position: center;
}

.btn-file {
    width: 100%;
    text-align: left;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    border-top: 0.5px solid #bbb6;
    border-bottom: 0.5px solid #bbb6;
}

.btn-selected {
    background-color: rgba(255, 255, 255, 0.3);
}

#file-toolbar {
    display: flex;
    gap: 0.25rem;
    align-items: center;
    margin: 0.5rem;
}

#file-path-field {
    width: 100%;
}

#file-list-container {
    background-color: #262c3b;
    width: 100%;
    height: 100%;
    overflow: auto;
    padding-bottom: 3rem;
}

.progress {
    height: 2rem;
    width: 2rem;
    position: relative;
}

.progress .under {
    position: relative;
    opacity: 0.5;
}

.progress .over {
    position: absolute;
    top: 0;
    left: 0;
}

#drop-highlight {
    pointer-events: none;
    position: absolute;
    width: 100%;
    height: 100%;
    opacity: 0.0;
    transition: opacity 0.5s;
    background-color: #0008;
    background-image: url(${icons.upload});
    background-repeat: no-repeat;
    background-position: center;
    background-blend-mode: multiply;
    background-size: 50% 75%;
}

#drop-highlight.visible {
    opacity: 0.6;
    transition: opacity 0.0s;
}

#context-menu {
    position: fixed;
    width: 8rem;
    background-color: #262c3b;
    border: 1px solid #e0e0e0;
}

.dialog {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.5);
    padding: 0.7rem;
    opacity: 0;
    animation: open 0.0s forwards;
    display: flex;
    align-items: center;
    justify-content: center;
}

@keyframes open {
    from {
        opacity: 0;
    }
    to {
        opacity: 1;
    }
}

.dialog-modal {
    max-width: 75%;
    background: #333b4f;
    color: white;
    font-size: 1.3rem;
    overflow: hidden;
    text-align: left;
    margin: 0 auto 0 auto;
    padding: 1rem;
    border-radius: 0.5rem;
    box-shadow: 0 0.25rem 0.25rem rgba(0, 0, 0, 0.5);
    opacity: 0;
    transform: scale(0.9);
    animation: open-modal 0.0s forwards;
}

#popup-title {
    margin-block-start: 0.5rem;
}

@keyframes open-modal {
    to {
        opacity: 1;
        transform: scale(1);
    }
}

.close-modal {
    display: none;
}

.buttons {
    background: transparent;
    display: flex;
    justify-content: flex-end;
    padding-top: 1rem;
}
`);

const FileManager_layout = (`
<div id=file-toolbar>
    <button class='btn-flat small' id=prev-dir style='background-image:url(${icons.prev});'></button>
    <button class='btn-flat small' id=next-dir style='background-image:url(${icons.next});'></button>
    <button class='btn-flat small' id=up-dir style='background-image:url(${icons.up});'></button>
    <input type='text' id=file-path-field></input>
    <button class='btn-flat small' id=refresh-dir style='background-image:url(${icons.refresh});'></button>
</div>

<div id=file-list-container>
    <template id=file-entry-template>
        <button class='btn-flat btn-file' id=file-button>
            <img id=file-thumb class='medium'>
            <p id=file-name></p>
            <div style='flex-grow:10;'></div>
            <div id=file-progress class='progress'>
                <img class='under'></img>
                <img class='over'></img>
            </div>
        </button>
    </template>
    <table id=file-list width='100%'>
    </table>
</div>
<input type='text' id=file-rename-field style='visibility:hidden;position:fixed'></input>

<div id='drop-highlight'></div>

<table id='context-menu' style='display:none'>
</table>

<div class="dialog close-modal" id=popup-dialog>
    <div class="dialog-modal">
        <h4 id=popup-title>Delete this item></h4>
        <p id=popup-content>You are about to delete this item</p>
        <div class="buttons">
            <button class="btn btn-ok" id=popup-ok>Ok</button>
            <button class="btn btn-cancel" id=popup-cancel>Cancel</button>
        </div>
    </div>
</div>
`);

const tasksProgress = {};

class FileEntry {
    constructor(template, manager, path) {
        this.element = template.content.cloneNode(true);
        this.nameEl = this.element.getElementById('file-name');
        this.renameEl = manager.document.getElementById('file-rename-field');
        this.thumbnailEl = this.element.getElementById('file-thumb');
        this.buttonEl = this.element.getElementById('file-button');
        this.progressBar = this.element.getElementById('file-progress');
        this.progressBarUnder = this.progressBar.getElementsByClassName('under')[0];
        this.progressBarOver = this.progressBar.getElementsByClassName('over')[0];

        this.manager = manager;
        this.path = path;
        this.selected = false;
        this.progressType = 'none';
        this.progress = -1;

        this.nameEl.innerHTML = getFileName(path);
        if (fileSystem.isDir(path)) {
            this.thumbnailEl.src = icons.folder;

            const dropHighlight = this.manager.dropHighlight;
            this.buttonEl.ondragover = ev => {
                ev.preventDefault();
                ev.stopPropagation();
                const rect = this.buttonEl.getBoundingClientRect();
                dropHighlight.classList.add('visible');
                dropHighlight.style.top = rect.top;
                dropHighlight.style.left = rect.left;
                dropHighlight.style.width = rect.width;
                dropHighlight.style.height = rect.height;
            }
            this.buttonEl.ondragleave = ev => {
                ev.preventDefault();
                ev.stopPropagation();
                dropHighlight.classList.remove('visible');
            }
            this.buttonEl.ondrop = ev => {
                dropHighlight.style.display = 'none';
                this.manager.handleFileUploadEvent(ev, this.path);
            }
        } else {
            this.thumbnailEl.src = icons.file;
        }

        this.buttonEl.onclick = ev => this.onclick(ev);
        this.buttonEl.ondblclick = () => this.ondblclick();
        this.buttonEl.oncontextmenu = ev => this.oncontextmenu(ev);
        this.buttonEl.addEventListener('fileremove', ev => {
            if (ev.detail.path == this.path) {
                this.selected = false;
                manager.fileEntries.splice(manager.fileEntries.indexOf(this), 1);
                manager.fileList.deleteRow(this.rowIndex);
            }
        });

        this.buttonEl.addEventListener('fileprogress', ev => {
            if (this.path == ev.detail.path) {
                this.progressType = ev.detail.type;
                this.progress = ev.detail.progress;
            }
        })

        this.renameEl.onblur = ev => {
            let self = this.renameEl.currentEntry;
            self.manager.renaming = false;
            self.nameEl.style.visibility = 'visible';
            self.renameEl.style.visibility = 'hidden';
        }
        this.renameEl.onchange = ev => {
            const self = ev.target.currentEntry;
            fileSystem.rename(self.path, parentDir(self.path) + '/' + ev.target.value).then(() => {
                self.manager.updateList();
            }).catch(err => {
                console.error(`Failed to rename item! ${err}`);
                fileSystem.refresh();
            });
            ev.target.onblur();
        }
    }

    onclick(ev) {
        const mngr = this.manager;
        const index_b = mngr.fileEntries.indexOf(this);
        if (ev.ctrlKey) {
            if (ev.shiftKey) {
                const index_a = mngr.fileEntries.indexOf(mngr.selectedEntries[mngr.selectedEntries.length - 1]);
                for (const i of range(index_a, index_b)) {
                    let entry = mngr.fileEntries[i];
                    if (entry.selected) {
                        entry.selected = false;
                    }
                    entry.selected = true;
                }
            } else {
                this.selected = !this.selected;
            }
        } else {
            const index_a = (mngr.selectedEntries.length == 0) ? 0 : mngr.fileEntries.indexOf(mngr.selectedEntries[0]);
            mngr.selectedEntries.selected = false;

            if (ev.shiftKey) {
                for (const i of range(index_a, index_b)) {
                    const entry = mngr.fileEntries[i];
                    entry.selected = true;
                }
            } else {
                this.selected = true;
            }
        }
    }

    ondblclick() {
        const mngr = this.manager;
        if (fileSystem.isDir(this.path)) {
            mngr.path = this.path;
            mngr.folderHistory = mngr.folderHistory.slice(0, mngr.folderHistoryIdx + 1);
            mngr.folderHistory.push(mngr.path);
            mngr.folderHistoryIdx = mngr.folderHistory.length - 1;
            mngr.updateList();
        } else {
            fileSystem.download(this.path, mngr.window);
        }
    }

    oncontextmenu(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        if (!this.selected) {
            this.buttonEl.click();
        }

        const { clientX: mouseX, clientY: mouseY } = ev;
        const mngr = this.manager;
        mngr.displayContextMenu(mouseX, mouseY, ['Cut', 'Copy', 'Paste', 'Delete', 'Download', 'Upload File(s)', 'Upload Folder'], (option) => {
            if (option == 0) {
                mngr.cutSelection();
            } else if (option == 1) {
                mngr.copySelection();
            } else if (option == 2) {
                mngr.pasteSelection(this.path);
            } else if (option == 3) {
                mngr.deleteSelection();
            } else if (option == 4) {
                for (const entry of mngr.selectedEntries) {
                    fileSystem.download(entry.path, mngr.window, progress => {
                        dispatchFileEvent('fileprogress', entry.path, { progress: progress, type: 'download' });
                    }).finally(() =>
                        dispatchFileEvent('fileprogress', entry.path, { progress: -1.0, type: 'download' })
                    );
                }
            } else if (option == 5 || option == 6) {
                mngr.requestUpload(option == 4 ? 'files' : 'folder', this.path);
            }

        });
    }

    rename() {
        this.manager.renaming = true;
        this.nameEl.style.visibility = 'hidden';
        this.renameEl.style.visibility = 'visible';
        this.renameEl.currentEntry = this;
        let oTop = this.nameEl.getBoundingClientRect().top;
        let oLeft = this.nameEl.getBoundingClientRect().left;
        this.renameEl.style.top = oTop - 4;
        this.renameEl.style.left = oLeft;
        this.renameEl.value = this.nameEl.innerHTML;
        this.renameEl.focus();
    }

    get progress() {
        return this._progress;
    }

    set progress(val) {
        this._progress = val;
        if (val < 0.0 || this.progressType == 'none') {
            this.progressBar.style.display = 'none';
            return;
        }

        let image;
        switch (this.progressType) {
            case 'download':
                image = icons.download;
                break;
            case 'upload':
                image = icons.upload;
                break;
            case _:
                console.error('Invalid progress type!');
                this.progressType = 'none';
                this.progress = -1;
                return;
        }

        this.progressBar.style.display = 'block';
        this.progressBarUnder.src = this.progressBarOver.src = image;
        this.progressBarOver.style.clipPath = `inset(0 0 ${(1.0 - val) * 2}rem 0)`;
    }

    get selected() {
        return this._selected;
    }

    set selected(val) {
        this._selected = val;
        const idx = this.manager.selectedEntries.indexOf(this);
        if (val) {
            if (idx == -1) {
                this.manager.selectedEntries.push(this);
            }
            this.buttonEl.focus();
            this.buttonEl.classList.add('btn-selected');
        } else {
            if (idx != -1) {
                this.manager.selectedEntries.splice(idx, 1);
            }
            this.buttonEl.blur();
            this.buttonEl.classList.remove('btn-selected');
        }
    }
}

class FileManager {
    constructor(path = fileSystem.root) {
        this.path = path;
        this.folderHistory = [path];
        this.folderHistoryIdx = 0;
        this.fileEntries = [];
        this.selectedEntries = [];
        this.dialogOpen = false;
        this.renaming = false;

        this.selectedEntries.fileEntries = this.fileEntries;
        Object.defineProperties(this.selectedEntries, {
            'selected': {
                set: function(val) {
                    if (val) {
                        for (const entry of this.fileEntries) {
                            entry.selected = true;
                        }
                    } else {
                        this.length = 0;
                        for (const entry of this.fileEntries) {
                            entry.selected = false;
                        }
                    }
                }
            }
        });

        this.window = window.open('', createUUID(), `
            toolbar=no,
            location=no,
            directories=no,
            status=no,
            menubar=no,
            scrollbars=yes,
            resizable=yes,
            width=720,
            height=540
        `);
        this.window.onbeforeunload = () => {
            const index = fileWindows.indexOf(this);
            if (index != -1) {
                fileWindows.splice(index, 1);
            }
        }

        this.document = this.window.document;

        let style = window.document.getElementsByTagName('style')[0].cloneNode(true);
        style.innerHTML += FileManager_style;
        this.document.head.appendChild(style);
        this.document.body.innerHTML = FileManager_layout;

        this.upFolderBtn = this.document.getElementById('up-dir');
        this.upFolderBtn.onclick = () => {
            if (this.renaming) return;
            this.path = parentDir(this.path);
            this.folderHistory = this.folderHistory.slice(0, this.folderHistoryIdx + 1);
            this.folderHistory.push(this.path);
            this.folderHistoryIdx = this.folderHistory.length - 1;
            this.updateList();
        }
        this.prevFolderBtn = this.document.getElementById('prev-dir');
        this.prevFolderBtn.onclick = () => {
            if (this.renaming) return;
            this.folderHistoryIdx -= 1;
            this.path = this.folderHistory[this.folderHistoryIdx];
            this.updateList();
        }
        this.nextFolderBtn = this.document.getElementById('next-dir');
        this.nextFolderBtn.onclick = () => {
            if (this.renaming) return;
            this.folderHistoryIdx += 1;
            this.path = this.folderHistory[this.folderHistoryIdx];
            this.updateList();
        }

        this.filePathInput = this.document.getElementById('file-path-field');
        this.filePathInput.onchange = ev => {
            if (this.path != ev.target.value && fileSystem.isDir(ev.target.value)) {
                this.path = ev.target.value;
                this.folderHistory = this.folderHistory.slice(0, this.folderHistoryIdx + 1);
                this.folderHistory.push(this.path);
                this.folderHistoryIdx = this.folderHistory.length - 1;
                this.updateList();
            } else {
                ev.target.value = this.path;
            }
        }

        this.refreshFolderBtn = this.document.getElementById('refresh-dir');
        this.refreshFolderBtn.onclick = () => {
            if (this.renaming) return;
            fileSystem.refresh().then(() => this.updateList())
        };

        this.dropHighlight = this.document.getElementById('drop-highlight');

        const fileListContainer = this.document.getElementById('file-list-container');
        fileListContainer.ondragleave = ev => {
            ev.preventDefault();
            this.dropHighlight.classList.remove('visible');
        };
        fileListContainer.ondragover = ev => {
            ev.preventDefault();
            this.dropHighlight.classList.add('visible');
            const rect = fileListContainer.getBoundingClientRect();
            this.dropHighlight.style.top = rect.top;
            this.dropHighlight.style.left = rect.left;
            this.dropHighlight.style.width = rect.width;
            this.dropHighlight.style.height = rect.height;
        }
        fileListContainer.ondrop = ev => {
            this.dropHighlight.style.display = 'none';
            this.handleFileUploadEvent(ev, this.path);
        }
        fileListContainer.oncontextmenu = ev => {
            ev.preventDefault();
            ev.stopPropagation();
            const { clientX: mouseX, clientY: mouseY } = ev;
            this.selectedEntries.selected = false;
            this.displayContextMenu(mouseX, mouseY, ['Paste', 'Upload File(s)', 'Upload Folder', 'New Folder'], (option) => {
                if (option == 0) {
                    this.pasteSelection(this.path);
                }
                if (option == 1 || option == 2) {
                    this.requestUpload(option == 1 ? 'files' : 'folder', this.path);
                } else if (option == 3) {
                    const newDir = adjustFileName(this.path + '/New Folder');
                    fileSystem.mkdir(newDir).then(() => {
                        dispatchFileEvent('fileadd', newDir);
                        for (const el of this.fileEntries) {
                            if (el.path == newDir) {
                                el.rename();
                                break;
                            }
                        }
                    });
                }
            });
        };

        this.fileList = this.document.getElementById('file-list');
        this.fileEntryTemplate = this.document.getElementById('file-entry-template');
        this.renameEl = this.document.getElementById('file-rename-field');

        this.contextMenu = this.document.getElementById('context-menu');
        this.contextMenu.style.display = 'none';

        this.document.addEventListener('keydown', ev => this.onkeydown(ev), false);
        this.document.addEventListener('fileadd', ev => {
            if (ev.detail.dir == this.path) {
                this.createFileEntry(ev.detail.path);
            }
        });
        this.document.addEventListener('fileprogress', ev => {
            tasksProgress[ev.detail.path] = {
                progress: ev.detail.progress,
                type: ev.detail.type
            };
        })
        this.document.querySelector('html').onclick = () => {
            this.contextMenu.style.display = 'none';
        };

        this.updateList();
    }

    updateList() {
        this.upFolderBtn.disabled = this.path == fileSystem.root;
        this.prevFolderBtn.disabled = this.folderHistoryIdx <= 0;
        this.nextFolderBtn.disabled = this.folderHistoryIdx >= this.folderHistory.length - 1;
        this.filePathInput.value = this.path;
        this.selectedEntries.length = 0;
        this.fileEntries.length = 0;

        this.document.title = 'Godot File Explorer: ' + getFileName(this.path);
        while (this.fileList.rows.length > 0) {
            this.fileList.deleteRow(-1);
        }

        let paths = fileSystem.listdir(this.path);
        paths.sort(function(a, b) {
            let aIsDir = fileSystem.isDir(a);
            let bIsDir = fileSystem.isDir(b);
            if (aIsDir && !bIsDir) {
                return -1;
            } else if (bIsDir && !aIsDir) {
                return 1;
            } else if (a < b) {
                return -1;
            } else if (a > b) {
                return 1;
            }
            return 0;
        });

        for (const path of paths) {
            if (path == '/home/web_user/keep') {
                continue;
            }
            this.createFileEntry(path);
        }
    }

    createFileEntry(path) {
        let row = this.fileList.insertRow(-1);
        let cell = row.insertCell(-1);

        const fileEntry = new FileEntry(this.fileEntryTemplate, this, path);
        if (!!tasksProgress[path]) {
            fileEntry.progressType = tasksProgress[path].type;
            fileEntry.progress = tasksProgress[path].progress;
        }

        fileEntry.rowIndex = row.rowIndex;
        this.fileEntries.push(fileEntry);
        cell.appendChild(fileEntry.element);
    }

    openDialog(type, title, message, confirmCallback = () => {}) {
        if (type == 'alert') {
            this.document.getElementById('popup-cancel').style.display = 'none';
            this.document.getElementById('popup-ok').focus();
        } else if (type == 'confirm') {
            this.document.getElementById('popup-cancel').style.display = 'block';
            this.document.getElementById('popup-cancel').focus();
        } else {
            console.error(`Invalid dialog type "${type}"!`);
            return;
        }

        this.dialogOpen = true;
        this.document.getElementById('popup-title').textContent = title;
        this.document.getElementById('popup-content').textContent = message;

        this.document.getElementById('popup-dialog').classList.remove("close-modal");

        let closeModal = () => {
            this.document.getElementById('popup-dialog').classList.add("close-modal");
            this.dialogOpen = false;
        }

        this.document.getElementById('popup-dialog').onclick = closeModal;
        this.document.getElementById('popup-cancel').onclick = closeModal;
        this.document.getElementById('popup-ok').onclick = () => {
            confirmCallback();
            closeModal();
        }
    }

    displayContextMenu(mouseX, mouseY, options, callback) {
        this.contextMenu.style.display = 'block';
        this.contextMenu.innerHTML = '';
        for (const i in options) {
            const button = this.document.createElement('button');
            button.innerHTML = options[i];
            button.classList.add('btn', 'btn-flat');
            button.style.whiteSpace = 'nowrap';
            button.style.textAlign = 'left';
            button.index = i;
            button.onclick = ev => {
                callback(ev.target.index);
                this.contextMenu.style.display = 'none';
            };
            button.oncontextmenu = ev => { ev.preventDefault() };
            this.contextMenu.appendChild(button);
        }

        const outOfBoundsOnX = mouseX + this.contextMenu.clientWidth > this.document.body.clientWidth - 10;
        const outOfBoundsOnY = mouseY + this.contextMenu.clientHeight > this.document.body.clientHeight - 10;
        let normalizedX = mouseX;
        let normalizedY = mouseY;
        if (outOfBoundsOnX) {
            normalizedX = this.document.body.clientWidth - this.contextMenu.clientWidth - 10;
        }
        if (outOfBoundsOnY) {
            normalizedY = this.document.body.clientHeight - this.contextMenu.clientHeight - 10;
        }
        this.contextMenu.style.top = `${normalizedY}px`;
        this.contextMenu.style.left = `${normalizedX}px`;
    }

    requestUpload(uploadType, dir) {
        const fileInput = this.document.createElement('input');
        fileInput.type = 'file';
        fileInput.onchange = ev => {
            if (ev.target.value) {
                this.handleFileUploadEvent(ev, dir);
            }
        }

        if (uploadType == 'files') {
            fileInput.multiple = true
        } else if (uploadType == 'folder') {
            fileInput.webkitdirectory = true
        } else {
            console.error(`'${uploadType}' is not a valid upload type to request!`);
            return;
        }
        fileInput.click();
    }

    onkeydown(ev) {
        if (this.dialogOpen) {
            if (ev.code == 'Escape') {
                this.document.getElementById('popup-cancel').onclick();
            }
        } else if (![this.renameEl, this.filePathInput].includes(this.document.activeElement)) {
            switch (ev.code) {
                case 'Delete':
                    ev.preventDefault();
                    if (this.selectedEntries.length) {
                        this.deleteSelection();
                    }
                    break;
                case 'F2':
                    ev.preventDefault();
                    if (this.selectedEntries.length) {
                        this.selectedEntries.slice(-1)[0].rename();
                    }
                    break;
                case 'KeyC':
                    if (ev.ctrlKey) {
                        ev.preventDefault();
                        this.copySelection();
                    }
                    break;
                case 'KeyX':
                    if (ev.ctrlKey) {
                        ev.preventDefault();
                        this.cutSelection();
                    }
                    break;
                case 'KeyV':
                    if (ev.ctrlKey) {
                        ev.preventDefault();
                        this.pasteSelection(this.path);
                    }
                    break;
                case 'KeyA':
                    if (ev.ctrlKey) {
                        ev.preventDefault();
                        this.selectedEntries.selected = this.selectedEntries.length != this.fileEntries.length;
                    }
                    break;
            }
        }
    }

    cutSelection() {
        if (this.selectedEntries.length) {
            clipboard = [...this.selectedEntries];
            movingClipboard = true;
        }
    }

    copySelection() {
        if (this.selectedEntries.length) {
            clipboard = [...this.selectedEntries];
            movingClipboard = false;
        }
    }

    pasteSelection(dir) {
        for (const entry of clipboard) {
            if (dir.includes(entry.path)) {
                this.openDialog('alert', 'You can\'t paste here!', `You we're attempting to paste the folder "${entry.path}" into itself.`);
                return;
            }
        }

        let promises = [];
        for (const entry of clipboard) {
            const dst = dir + '/' + getFileName(entry.path);
            if (movingClipboard) {
                promises.push(fileSystem.rename(entry.path, dst));
            } else {
                promises.push(fileSystem.copy(entry.path, dst));
            }
        }
        Promise.all(promises).then(() => {
            for (const entry of clipboard) {
                dispatchFileEvent('fileadd', dir + '/' + getFileName(entry.path));
                if (movingClipboard) {
                    dispatchFileEvent('fileremove', entry.path);
                }
            }
            if (movingClipboard) {
                clipboard.length = 0;
            }
        }).catch(err => {
            console.error(`Failed to paste clipboard! ${err}`);
            fileSystem.refresh();
        });
    }

    deleteSelection() {
        const message = this.selectedEntries.length == 1 ?
            `"${getFileName(this.selectedEntries[0].path)}"` :
            `the ${this.selectedEntries.length} selected items`;
        this.openDialog('confirm', `Delete ${message}?`, `This action is permanent and cannot be undone!`, () => {
            const promises = [];
            for (const entry of this.selectedEntries) {
                promises.push(fileSystem.remove(entry.path));
            }
            Promise.all(promises).then(() => {
                for (const entry of this.selectedEntries) {
                    dispatchFileEvent('fileremove', entry.path);
                }
            }).catch(err => {
                console.error(`Failed to delete files! ${err}`);
                fileSystem.refresh();
            })
        });
    }

    handleFileUploadEvent(ev, dir) {
        ev.stopPropagation();
        ev.preventDefault();

        function traverseFileTreePromise(item, fileList, folderList) {
            return new Promise(resolve => {
                if (item.isFile) {
                    item.file(file => {
                        file.filepath = item.fullPath.slice(1); // save full path
                        fileList.push(file);
                        resolve(file);
                    });
                } else if (item.isDirectory) {
                    folderList.push(item.fullPath.slice(1));
                    let dirReader = item.createReader();
                    let entriesPromises = [];

                    function readEntries() {
                        // readEntries has a limit to how many items it can return at once, hence it needs to be called multiple times.
                        dirReader.readEntries(entries => {
                            if (entries.length > 0) {
                                for (let entr of entries) {
                                    entriesPromises.push(traverseFileTreePromise(entr, fileList, folderList));
                                }
                                readEntries();
                            } else {
                                resolve(Promise.all(entriesPromises));
                            }
                        });
                    }
                    readEntries();
                }
            });
        }

        const files = [];
        const folders = [];
        const promises = [];
        if (ev.target && ev.target.files) {
            Array.from(ev.target.files).forEach(file => {
                if (file.webkitRelativePath) {
                    file.filepath = file.webkitRelativePath;
                } else {
                    file.filepath = file.name;
                }

                let folder = parentDir(file.filepath);
                while (folder != '' && !folders.includes(folder)) {
                    folders.push(folder);
                    folder = parentDir(folder);
                }
                files.push(file);
            });
        } else if (ev.dataTransfer.items) {
            for (const item of ev.dataTransfer.items) {
                item.entry = item.webkitGetAsEntry || item.getAsEntry;
                if (item.entry) {
                    promises.push(traverseFileTreePromise(item.entry(), files, folders));
                } else if (item.kind === 'file') {
                    const file = item.getAsFile();
                    file.filepath = file.name;
                    files.push(file);
                }
            }
        } else {
            for (const file of ev.dataTransfer.files) {
                file.filepath = file.name;
                files.push(file);
            }
        }

        Promise.all(promises).then(() => {
            const promises = [];
            const foldersCreated = [];
            for (const file of files) {
                const dst = parentDir(dir + '/' + file.filepath);

                let folder = dst;
                while (!fileSystem.isDir(folder) && !foldersCreated.includes(folder)) {
                    foldersCreated.push(folder);
                    folder = parentDir(folder);
                }
                promises.push(fileSystem.mkdirs(dst).then(() => fileSystem.addfile(file, dst)));
            }
            for (const folder of folders) {
                const dst = dir + '/' + folder;
                if (!foldersCreated.includes(dst)) {
                    promises.push(fileSystem.mkdirs(dst));
                    foldersCreated.push(dst);
                }
            }
            return Promise.all(promises);
        }).then(() => {
            for (const file of files) {
                dispatchFileEvent('fileadd', dir + '/' + file.filepath);
            }
            for (const folder of folders) {
                dispatchFileEvent('fileadd', dir + '/' + folder);
            }
        }).catch(err => {
            console.error(`Failed to upload files! ${err}`);
            fileSystem.refresh();
        });
    }
}

let indexedDB;
let clipboard = [];
let movingClipboard = false;

(function() {
    'use strict';

    const connection = window.indexedDB.open(fileSystem.root, 21);
    connection.onsuccess = function(ev) {
        console.debug('IndexedDB connection established!');
        indexedDB = ev.target.result;
        fileSystem.refresh().then(() => {
            let btnFileManager = document.getElementById('btn-file-manager');

            console.debug('File system loaded!');
            if (btnFileManager == null) {
                btnFileManager = document.createElement('button');
                btnFileManager.id = 'btn-file-manager';
                btnFileManager.className = 'btn tab-btn';
                btnFileManager.innerHTML = 'File Manager';

                let tabs = document.getElementById('tabs-buttons');
                tabs.appendChild(btnFileManager);
            }

            btnFileManager.onclick = function() {
                let fileManager = new FileManager();
                fileWindows.push(fileManager);
            }

            window.onbeforeunload = function() {
                for (const fileManager of fileWindows) {
                    fileManager.window.close();
                }
            }
        }).catch(err => {
            console.error(`Failed to load the file system! ${err}`);
        });
    };

})();

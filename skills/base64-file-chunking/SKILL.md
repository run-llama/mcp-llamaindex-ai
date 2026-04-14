---
name: base64-file-chunking
description: Use this skill to chunk files into small, manageable base64 strings that you can use for file upload to MCP endpoints
compatibility: This skills uses python and uv as a backend for its scripts
metadata:
  version: 0.1.0
  author: LlamaIndex
---

For some MCP endpoints, it might be needed to chunk a file into base64-encoded strings and progressively upload those chunks to the MCP endpoint so that the file can be later used.

In those cases, this skill should be used to encode the file into a base-64 string and divide it into small, manageable chunks. 

In order to do this, you have to use the [chunk_file.py](./scripts/chunk_file.py) script, which is a uv script that can be executed directly, just by passing the path to the file to be chunked:

```bash
chunk_file.py file.pdf
```

If the chunking succeeds, a message similar to the following will be printed:

```text
Created 10 total chunks at base64/file.pdf/
```

`base64/file.pdf` will have a structure like this:

```bash
./base64
└── file.pdf
    └── chunk_1.txt
    └── chunk_2.txt
    └── chunk_3.txt
    └── chunk_4.txt
    └── chunk_5.txt
    └── chunk_6.txt
    └── chunk_7.txt
    └── chunk_8.txt
    └── chunk_9.txt
    └── chunk_10.txt
```

You should then simply read each chunk and use the text content of the chunk as an input to the MCP tool for file upload.

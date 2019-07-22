var jvm = {};

(function () {
	jvm.klasses = {};
	jvm.classObjects = {};
	jvm.stringPool = {}; //字符串常量池

	function makePrimitiveKlass(descriptor, name) {
		return jvm.klasses[descriptor] =
			new Klass(name, descriptor, 'java/lang/Object', [], 0x1011/*ACC_PUBLIC | ACC_FINAL | ACC_SYNTHETIC*/, [], [], null, [null], [null]);
	}
	jvm.klasses['V'] = makePrimitiveKlass('V', 'void');
	jvm.klasses['Z'] = makePrimitiveKlass('Z', 'boolean');
	jvm.klasses['C'] = makePrimitiveKlass('C', 'char');
	jvm.klasses['F'] = makePrimitiveKlass('F', 'float');
	jvm.klasses['D'] = makePrimitiveKlass('D', 'double');
	jvm.klasses['B'] = makePrimitiveKlass('B', 'byte');
	jvm.klasses['S'] = makePrimitiveKlass('S', 'short');
	jvm.klasses['I'] = makePrimitiveKlass('I', 'int');
	jvm.klasses['J'] = makePrimitiveKlass('J', 'long');

	function Klass(name, descriptor, superClass, interfaces, access_flags, methods, fields, bytes, constant_pool, constant_pool_types) {
		this.name = name;
		this.descriptor = descriptor;
		this.superClass = superClass;
		this.interfaces = interfaces;
		this.access_flags = access_flags;
		this.methods = methods;
		this.fields = fields;
		this.bytes = bytes;
		this.constant_pool = constant_pool;
		this.constant_pool_types = constant_pool_types;
	}

	Klass.prototype.isSubClassOf = function (klass) {
		var me = this;
		if (me === klass) return true;
		var myDescriptor = me.descriptor;
		var klassDescriptor = klass.descriptor;
		/*处理数组 */
		var dimension = 0;
		while (true) {
			if (myDescriptor[dimension] == '[') {
				if (klassDescriptor[dimension] == '[')++dimension;
				else return false;
			} else if (klassDescriptor[dimension] == '[') return false;
			else break;
		}
		if (dimension > 0) {
			me = jvm.loadClass(myDescriptor.substring(dimension));
			klass = jvm.loadClass(klassDescriptor.substring(dimension));
		}
		// Check superclasses
		if (klass.access_flags & 0x0200) {
			// interface
			while (me) {
				for (var i = 0; i < me.interfaces.length; i++) {
					if (me.interfaces[i] == klass.name) return true;
				}
				me = me.superClass && jvm.loadClass(me.superClass);
			}
		} else {
			for (var mySuperClass = null; me.superClass; me = mySuperKlass) {
				mySuperKlass = jvm.loadClass(me.superClass);
				if (mySuperKlass == klass) return true;
			}
		}
		return false;
	}

	jvm.getLoadedClass = function (descriptor) {
		if (descriptor[0] == 'L') descriptor = descriptor.substring(1, descriptor.length - 1);
		if (jvm.klasses[descriptor]) return jvm.klasses[descriptor];
		if (descriptor[0] == "[") return jvm.klasses[descriptor] = new Klass(descriptor, descriptor, 'java/lang/Object', [], 0x1011, [], [], null, [null], [null]); //array klass
		throw '\'' + descriptor + '\' not loaded, use jvm.loadClass() first.';
	}

	jvm.loadClass = function (descriptor, callback) {
		if (descriptor[0] == 'L') descriptor = descriptor.substring(1, descriptor.length - 1);
		var klass = jvm.klasses[descriptor];
		if (!klass && descriptor[0] == "[") klass = jvm.getLoadedClass(descriptor);
		if (klass) {
			setTimeout(function () {
				callback(klass);
			}, 0);
			return;
		}

		jvm.loadClassFile(descriptor, loadSuperClass);
		return;

		function loadSuperClass(kls) {
			if (kls.superClass) {
				jvm.loadClass(kls.superClass, initClass.bind(this, kls));
			} else {
				initClass(kls);
			}
		}

		function initClass(kls) {
			if (kls.methods["<clinit>()V"]) {
				jvm.interpreter.invokeFirst(kls, kls.methods["<clinit>()V"], null, cacheClass.bind(this, kls));
			} else {
				cacheClass(kls);
			}
		}

		function cacheClass(kls) {
			jvm.klasses[descriptor] = kls;
			if (kls.onInitFinish) {
				kls.onInitFinish();
			}
			callback(kls);
		}
	}

	jvm.loadClassFile = function (className, callback) {
		var bytes = jvm.download("../lib/" + className + ".class", parseClassFile);

		function parseClassFile(bytes) {
			if (!(bytes[0] == 0xCA && bytes[1] == 0xFE && bytes[2] == 0xBA && bytes[3] == 0xBE)) {
				throw "Not a class file";
			}

			var pos = 4;

			function u2() {
				return 256 * bytes[pos++] + bytes[pos++];
			}

			function u4() {
				return 256 * 256 * 256 * bytes[pos++] + 256 * 256 * bytes[pos++] + 256 * bytes[pos++] + bytes[pos++];
			}

			function u1() {
				return bytes[pos++];
			}

			function utf8string() {
				var len = u2();
				var end = pos + len;
				var chars = new Array(len);
				while (pos < end) {
					var x = bytes[pos++];
					if (x < 0x80) {
						chars.push(String.fromCharCode(x));
					} else {
						var y = bytes[pos++];
						if ((x & 0xe0) == 0xc0) {
							chars.push(String.fromCharCode(((x & 0x1f) << 6) + (y & 0x3f)));
						} else if ((x & 0xf0) == 0xe0) {
							var z = bytes[pos++];
							chars.push(String.fromCharCode(((x & 0xf) << 12) + ((y & 0x3f) << 6) + (z & 0x3f)));
						} else {
							throw "Illegal unicode character";
						}
					}
				}
				return chars.join('');
			}

			u2(); // minor version
			u2(); // major version

			var constant_pool_count = u2();
			var constant_pool = [null];
			var constant_pool_types = [null];
			while (constant_pool.length < constant_pool_count) {
				var type = u1();
				constant_pool_types.push(type);
				switch (type) {
					case 0:
						pos--;
						break;
					case 7: //CONSTANT_Class
						var name_index = u2();
						constant_pool.push(name_index);
						break;
					case 9: //CONSTANT_Fieldref
					case 10: //CONSTANT_Methodref
					case 11: //CONSTANT_InterfaceMethodref
						var class_index = u2();
						var name_and_type_index = u2();
						constant_pool.push({ class_index: class_index, name_and_type_index: name_and_type_index });
						break;
					case 8: // CONSTANT_String
						constant_pool.push(u2());
						break;
					case 3: // CONSTANT_Integer
						var val = u4();
						constant_pool.push((val > 0x7FFFFFFF) ? - (0xFFFFFFFF - val) - 1 : val);
						break;
					case 4: // CONSTANT_Float
						var b = u4();
						switch (true) {
							case (b == 0x7f800000):
								constant_pool.push(Number.POSITIVE_INFINITY);
								break;
							case (b == 0xff800000):
								constant_pool.push(Number.NEGATIVE_INFINITY);
								break;
							case ((b >= 0x7f800001 && b <= 0x7fffffff) || (b > 0xff800001 && b <= 0xffffffff)):
								constant_pool.push(NaN);
								break;
							default:
								var s = ((b >> 31) == 0) ? 1 : -1;
								var e = ((b >> 23) & 0xff);
								var m = (e == 0) ?
									(b & 0x7fffff) << 1 :
									(b & 0x7fffff) | 0x800000;
								constant_pool.push(s * m * Math.pow(2, e - 150));
								break;
						}
						break;
					case 5: // CONSTANT_Long
						var high_bytes = u4();
						var low_bytes = u4();
						constant_pool.push(new Long(low_bytes, high_bytes));
						constant_pool.push(null);
						constant_pool_types.push(null);
						break;
					case 6: // CONSTANT_Double
						var high_bytes = u4();
						var low_bytes = u4();
						switch (true) {
							case (high_bytes == 0x7ff00000 && low_bytes == 0):
								constant_pool.push(Number.POSITIVE_INFINITY);
								break;
							case (high_bytes == 0xfff00000 && low_bytes == 0):
								constant_pool.push(Number.NEGATIVE_INFINITY);
								break;
							case (high_bytes > 0x7ff00000 && high_bytes <= 0x7fffffff):
								constant_pool.push(NaN);
								break;
							case (high_bytes > 0xfff00000 && high_bytes <= 0xffffffff):
								constant_pool.push(NaN);
								break;
							default:
								var s = ((high_bytes >> 31) == 0) ? 1 : -1;
								var e = ((high_bytes >> 20) & 0x7ff);
								var m = (e == 0) ?
									(((high_bytes & 0xfffff)) + low_bytes * Math.pow(2, -32)) << 1 :
									((high_bytes & 0xfffff | 0x100000) + (low_bytes * Math.pow(2, -32)));
								constant_pool.push(s * m * Math.pow(2, e - 1043));
								break;
						}
						constant_pool.push(null);
						constant_pool_types.push(null);
						break;
					case 12: // CONSTANT_NameAndType
						var name_index = u2();
						var descriptor_index = u2();
						constant_pool.push({ name_index: name_index, descriptor_index: descriptor_index });
						break;
					case 1: // CONSTANT_Utf8
						var string = utf8string();
						constant_pool.push(string);
						break;
					default:
						console.log("UNKNOWN constant TYPE " + type + " at index " + constant_pool.length);
				}
			}
			var access_flags = u2();
			//	var acc = [];
			//	if (access_flags & 0x0001) {
			//		acc.push("public")
			//	}
			//	if (access_flags & 0x0010) {
			//		acc.push("final")
			//	}
			//	if (access_flags & 0x0020) {
			//		acc.push("super")
			//	}
			//	if (access_flags & 0x0200) {
			//		acc.push("interface")
			//	}
			//	if (access_flags & 0x0400) {
			//		acc.push("abstract")
			//	}
			//	console.log("access_flags: " + acc.join(" "));

			var name = constant_pool[constant_pool[u2()]]; // console.log("this_class:" + constant_pool[u2()]);
			var superClass = constant_pool[constant_pool[u2()]]; // console.log("extends " + constant_pool[u2()]);
			var interfaces_count = u2();

			//	console.log("interfaces_count:" + interfaces_count);
			var interfaces = [];
			for (var i = 0; i < interfaces_count; i++) {
				interfaces.push(constant_pool[constant_pool[u2()]]); //console.log("implements " + constant_pool[u2()]);
			}

			function processAttributes() {
				var attributes_count = u2();
				for (var j = 0; j < attributes_count; j++) {
					var attribute_name_index = u2();
					//			console.log("attribute: " + );
					var attribute_length = u4();
					pos += attribute_length;
				}
			}

			var fields = {};
			var fields_count = u2();
			var offset = 0;
			//	console.log("fields_count: " + fields_count);
			for (var i = 0; i < fields_count; i++) {
				var _access_flags = u2();
				var name_index = u2();
				//		console.log("field: " + constant_pool[name_index - 1]);
				var descriptor_index = u2();
				//		console.log("descriptor: " + constant_pool[descriptor_index - 1]);
				var descriptor = constant_pool[descriptor_index];
				fields[constant_pool[name_index]] = {
					access_flags: _access_flags,
					name: constant_pool[name_index],
					descriptor: constant_pool[descriptor_index],
					offset: offset++,
					static_value: undefined
				}
				// Find constantvalue
				var attributes_count = u2();

				for (var j = 0; j < attributes_count; j++) {
					var attribute_name_index = u2();
					var attribute_length = u4();
					if ("ConstantValue" == constant_pool[attribute_name_index]) {
						fields[constant_pool[name_index]].static_value = constant_pool[u2()];
					} else {
						pos += attribute_length;
					}
				}
			}

			var methods = {};
			var methods_count = u2();
			for (var i = 0; i < methods_count; i++) {
				var startpos = pos;
				var _access_flags = u2();
				var name_index = u2();
				var descriptor_index = u2();

				var codepos = -1;

				var attributes_count = u2();

				var exception_handlers = [];
				for (var j = 0; j < attributes_count; j++) {
					var attribute_name_index = u2();
					var attribute_length = u4();
					if ("Code" == constant_pool[attribute_name_index]) {
						codepos = pos;
						var max_stack = u2();
						var max_locals = u2();
						var code_length = u4();
						pos += code_length;
						var exception_table_length = u2();
						for (var k = 0; k < exception_table_length; k++) {
							var start_pc = u2();
							var end_pc = u2();
							var handler_pc = u2();
							var catch_type = u2();
							exception_handlers.push({
								start_pc: start_pc,
								end_pc: end_pc,
								handler_pc: handler_pc,
								catch_type: constant_pool[constant_pool[catch_type]]
							});
						}
						processAttributes();
					} else {
						pos += attribute_length;
					}
				}

				var descriptor = constant_pool[descriptor_index];
				var paramTypes = [];
				var returnType = null;
				var prefix = "";
				for (var j = 0; j < descriptor.length; j++) {
					switch (descriptor[j]) {
						case "(":
							continue;
						case "[":
							prefix += "[";
							continue;
						case "L": // Object
							var scpos = descriptor.indexOf(";", j);
							paramTypes.push(prefix + descriptor.substring(j, scpos + 1));
							prefix = "";
							j = scpos;
							continue;
						case ")":
							returnType = descriptor.substring(j + 1);
							j = descriptor.length;
							break;
						default:
							paramTypes.push(prefix + descriptor[j]);
							prefix = "";
					}
				}

				methods[constant_pool[name_index] + constant_pool[descriptor_index]] = {
					pos: startpos,
					codepos: codepos,
					descriptor: descriptor,
					name: constant_pool[name_index],
					access_flags: _access_flags,
					paramTypes: paramTypes,
					returnType: returnType,
					exception_handlers: exception_handlers,
					toString: function () {
						return this.name + this.descriptor;
					}
				};
			}


			processAttributes();

			//	var attributes_count = u2();
			//	console.log("attributes count: " + attributes_count);
			//	for(var i = 0; i < attributes_count; i++) {
			//		var attribute_name_index = u2();
			//		console.log("attribute: " + constant_pool[attribute_name_index - 1]);
			//		var attribute_length = u4();
			//		pos += attribute_length;
			//	}
			callback(jvm.klasses[name] = new Klass(name, 'L' + name + ';', superClass, interfaces, access_flags, methods, fields, bytes, constant_pool, constant_pool_types));
		}
	};

	jvm.download = function (url, callback) {
		var xmlhttp = new XMLHttpRequest();
		xmlhttp.responseType = 'arraybuffer'
		xmlhttp.open('GET', url, true);
		xmlhttp.overrideMimeType('text/plain; charset=x-user-defined');
		xmlhttp.send(null);

		xmlhttp.onload = function (ev) {
			if (xmlhttp.status != 200) {
				throw xmlhttp.status + "Could not load file: " + url;
			}
			callback(new Uint8Array(xmlhttp.response));
		}
	}

	jvm.getClassObject = function (klassOrDescriptor, callback) {
		if (typeof klassOrDescriptor === 'string') {
			jvm.loadClass(klassOrDescriptor, createClassObject);
		} else {
			createClassObject(klassOrDescriptor);
		}
		function createClassObject(klass) {
			var key = klass.name;
			if (jvm.classObjects[key]){
				callback(jvm.classObjects[key]);
				return;
			}
			jvm.newInstance("java/lang/Class", function(result){
				result.setMetadata("targetKlass", klass);
				jvm.newInternedString(key, function(strObj){
					result.setField("name", strObj);
					jvm.classObjects[key] = result;
					callback(klass);
				});
			});
		}
	}

	var JObjectProto = makeObjectPrototype(Object.prototype);
	var JArrayProto = makeArrayPrototype(Array.prototype);
	var JArrayProtoUint8 = makeObjectPrototype(Uint8Array.prototype);
	var JArrayProtoUint16 = makeObjectPrototype(Uint16Array.prototype);
	var JArrayProtoUint32 = makeObjectPrototype(Uint32Array.prototype);
	var JArrayProtoInt8 = makeObjectPrototype(Int8Array.prototype);
	var JArrayProtoInt16 = makeObjectPrototype(Int16Array.prototype);
	var JArrayProtoInt32 = makeObjectPrototype(Int32Array.prototype);
	var JArrayProtoFloat32 = makeObjectPrototype(Float32Array.prototype);
	var JArrayProtoFloat64 = makeObjectPrototype(Float64Array.prototype);
	var JStringProto = makeStringPrototype(Object.prototype);

	jvm.newArraySync = function (componentKlass, count) {
		var value;
		switch (componentKlass.descriptor) {
			case "Z":
				value = new Uint8Array(count);
				value.__proto__ = JArrayProtoUint8;
				break;
			case "B":
				value = new Int8Array(count);
				value.__proto__ = JArrayProtoInt8;
				break;
			case "F":
				value = new Float32Array(count);
				value.__proto__ = JArrayProtoFloat32;
				break;
			case "D":
				value = new Float64Array(count);
				value.__proto__ = JArrayProtoFloat64;
				break;
			case "C":
				value = new Uint16Array(count);
				value.__proto__ = JArrayProtoUint16;
				break;
			case "S":
				value = new Int16Array(count);
				value.__proto__ = JArrayProtoInt16;
				break;
			case "I":
				value = new Int32Array(count);
				value.__proto__ = JArrayProtoInt32;
				break;
			default:
				value = new Array(count);
				value.__proto__ = JArrayProto;
				break;
		}

		if (componentKlass.descriptor === 'I') {
			for (var i = 0; i < count; i++) {
				value[i] = 0;
			}
		}
		if (componentKlass.descriptor === 'J') {
			for (var i = 0; i < count; i++) {
				value[i] = Long.fromNumber(0);
			}
		}

		var klass = jvm.getLoadedClass('[' + componentKlass.descriptor);
		value[".metadata"] = {
			componentKlass: componentKlass,
			klass: klass
		};
		return value;
	}

	jvm.newArray = function(componentKlass, count, callback){
		setTimeout(() => {
			callback(jvm.newArraySync(componentKlass, count));
		}, 0);
	}

	jvm.newString = function (str, callback) {
		var internedStrObj = this.stringPool[str];
		if (internedStrObj !== undefined) {
			setTimeout(() => {
				callback(internedStrObj);
			}, 0);
			return;
		}
		jvm.loadClass('java/lang/String', function (strKlass) {
			var strObj = {};
			strObj.__proto__ = JStringProto;
			strObj[".metadata"] = {
				klassName: 'java/lang/String',
				klass: strKlass
			}
			jvm.newArray(jvm.getLoadedClass('C'), str.length, function(value){
				for (var i = 0; i < str.length; ++i) {
					value[i] = str.charCodeAt(i);
				}
				strObj.value = value;
				callback(strObj);
			});
		})
	}

	jvm.newInternedString = function (str, callback) {
		jvm.newString(str, function (strObj) {  //may be interned or new one
			jvm.stringPool[str] = strObj;
			callback(strObj);
		});
	}

	jvm.internStringObjectSync = function (strObj) {
		if (typeof strObj == 'string') debugger; //strObj should be java String object
		var key = strObj.toString();
		var internedStrObj = jvm.stringPool[key];
		if (internedStrObj === undefined) {
			internedStrObj = jvm.stringPool[key] = strObj;
		}
		return internedStrObj;
	}

	jvm.newInstance = function (className, callback) {
		var proto = JObjectProto;
		if (className === 'java/lang/String') proto = JStringProto;
		jvm.loadClass(className, function (klass) {
			var obj = {
				__proto__: proto,
				".metadata": {
					klassName: klass.name,
					klass: klass
				}
			};
			callback(obj);
		});
	};

	function makeObjectPrototype(baseProto) {
		var protoObj = { __proto__: baseProto };
		protoObj.setMetadata = function (key, value) {
			this[".metadata"][key] = value;
		}

		protoObj.getMetadata = function (key) {
			return this[".metadata"][key];
		}

		protoObj.getKlass = function () {
			return this[".metadata"].klass;
		}

		protoObj.getField = function (fieldName) {
			if (!(fieldName in this)) {
				debugger; /* Field not exist */
			}
			return this[fieldName];
		}

		protoObj.setField = function (fieldName, val) {
			this[fieldName] = val;
		}

		return protoObj;
	}

	function makeArrayPrototype(baseProto) {
		var protoObj = makeObjectPrototype(baseProto);
		protoObj.getComponentKlass = function () {
			return this[".metadata"].componentKlass;
		}
		return protoObj;
	}

	function makeStringPrototype(baseProto) {
		var protoObj = makeObjectPrototype(baseProto);
		protoObj.toString = function () {
			if (!('nativeString' in this)) {
				var charArrValue = this.value;
				var chars = new Array(charArrValue.length);
				for (var i = 0; i < charArrValue.length; ++i) {
					chars[i] = String.fromCharCode(charArrValue[i]);
				}
				this.nativeString = chars.join('');
			}
			return this.nativeString;
		}
		return protoObj;
	}

}).apply(jvm);